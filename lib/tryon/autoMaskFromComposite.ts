import sharp from "sharp";
import type { CategoryId } from "@/types";

/**
 * Server-side fallback mask generator.
 *
 *  Strategy ─ diff-based silhouette + feathered contact band:
 *    1. Resize both `userImage` and `compositeImage` to the same target
 *       dimensions (the OpenAI output size).
 *    2. For each pixel, measure RGB diff between user and composite.
 *       Pixels whose mean diff is above PIXEL_DIFF_THRESHOLD are
 *       considered "product pixels" — that's the silhouette.
 *    3. Dilate the silhouette by `dilatePx` to widen the editable area
 *       slightly past the product edge (contact zone).
 *    4. Apply a Gaussian feather of `featherPx` so the AI gets a smooth
 *       boundary (avoids the seam-on-the-skin artefact).
 *    5. Return a black/white PNG sized exactly to the target. White =
 *       editable, black = preserved (project-internal convention; the
 *       OpenAI provider converts to alpha before calling the API).
 *
 *  This is identical in spirit to the browser-side `buildContactMask`
 *  used by the watch flow, but it doesn't need MediaPipe — it works
 *  off an already-composited image. It's the safety net the route
 *  hits when the client (e.g. JS disabled, headless test) didn't send
 *  a mask but did send a composite.
 *
 *  No false promises:
 *    - When the composite differs from the user image only minimally
 *      (e.g. a transparent product that barely changed pixels), the
 *      silhouette will be tiny and `ratio` will be below
 *      MIN_SILHOUETTE_RATIO. We return `null` in that case so the
 *      caller can fall back to deterministic.
 *    - When the composite is wildly different (>50%), we also bail —
 *      that signals a misaligned composite, not a valid try-on.
 */

const PIXEL_DIFF_THRESHOLD = (() => {
  const raw = process.env.OPENAI_PRODUCT_LOCK_DIFF_THRESHOLD?.trim();
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v > 0 && v < 255 ? v : 18;
})();

const MIN_SILHOUETTE_RATIO = 0.001;
const MAX_SILHOUETTE_RATIO = 0.5;

export interface AutoMaskInput {
  /** PNG/JPEG buffer of the original user photo (no product). */
  userImage: Buffer;
  /** PNG buffer of the composite (user photo + product placed). */
  compositeImage: Buffer;
  /** Target output width (matches OpenAI image size). */
  targetWidth: number;
  /** Target output height (matches OpenAI image size). */
  targetHeight: number;
  /** Optional override of the dilation radius. Default 6 px. */
  dilatePx?: number;
  /** Optional override of the Gaussian feather radius. Default 14 px. */
  featherPx?: number;
  /**
   * When set, the function builds a category-appropriate mask:
   *
   *   - "watch" / "hand-jewelry": a thin integration ring (outer
   *     dilation 12 px minus inner erosion 4 px). The product core is
   *     preserved so OpenAI cannot redraw the dial / bracelet.
   *   - "glasses" / "headwear": light dilation + feather, no erosion
   *     (those products are less identity-sensitive).
   *   - "clothes" or undefined: legacy full-silhouette feathered mask.
   */
  category?: CategoryId;
}

export interface AutoMaskResult {
  /**
   * Black/white PNG buffer with the editable region in white. Dimensions
   * exactly match `targetWidth` × `targetHeight`.
   */
  buffer: Buffer;
  /** Ratio of bright pixels (>= 25) to total pixels. 0..1. */
  coverage: number;
}

interface RawRGBA {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

async function toRawAt(
  src: Buffer,
  w: number,
  h: number
): Promise<RawRGBA> {
  const { data, info } = await sharp(src)
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels === 4 ? 4 : 3,
  };
}

function diffSilhouette(
  user: RawRGBA,
  composite: RawRGBA,
  threshold: number
): { mask: Buffer; count: number } {
  const w = user.width;
  const h = user.height;
  const px = w * h;
  const out = Buffer.alloc(px);
  let count = 0;
  for (let i = 0; i < px; i++) {
    const dr = Math.abs(user.data[i * user.channels] - composite.data[i * composite.channels]);
    const dg = Math.abs(
      user.data[i * user.channels + 1] - composite.data[i * composite.channels + 1]
    );
    const db = Math.abs(
      user.data[i * user.channels + 2] - composite.data[i * composite.channels + 2]
    );
    if ((dr + dg + db) / 3 > threshold) {
      out[i] = 255;
      count++;
    }
  }
  return { mask: out, count };
}

/** Iterative binary dilation by `radius` pixels (4-neighbours per pass). */
function dilate(mask: Buffer, w: number, h: number, radius: number): Buffer {
  // Use Uint8Array so the variance between Buffer<ArrayBufferLike> and
  // Buffer<ArrayBuffer> in current @types/node doesn't make TypeScript
  // unhappy when swapping src/dst.
  let src: Uint8Array = Uint8Array.from(mask);
  let dst: Uint8Array = new Uint8Array(mask.length);
  for (let r = 0; r < Math.max(0, Math.round(radius)); r++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] === 255) {
          dst[i] = 255;
          continue;
        }
        const left = x > 0 ? src[i - 1] : 0;
        const right = x < w - 1 ? src[i + 1] : 0;
        const up = y > 0 ? src[i - w] : 0;
        const down = y < h - 1 ? src[i + w] : 0;
        dst[i] = left || right || up || down ? 255 : 0;
      }
    }
    const tmp = src;
    src = dst;
    dst = tmp;
    dst.fill(0);
  }
  return Buffer.from(src);
}

/** Iterative binary erosion. Pixels lose their value if any neighbour is 0. */
function erode(mask: Buffer, w: number, h: number, radius: number): Buffer {
  let src: Uint8Array = Uint8Array.from(mask);
  let dst: Uint8Array = new Uint8Array(mask.length);
  for (let r = 0; r < Math.max(0, Math.round(radius)); r++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] === 0) {
          dst[i] = 0;
          continue;
        }
        const left = x > 0 ? src[i - 1] : 0;
        const right = x < w - 1 ? src[i + 1] : 0;
        const up = y > 0 ? src[i - w] : 0;
        const down = y < h - 1 ? src[i + w] : 0;
        dst[i] = left && right && up && down ? 255 : 0;
      }
    }
    const tmp = src;
    src = dst;
    dst = tmp;
    dst.fill(0);
  }
  return Buffer.from(src);
}

interface RingMaskParams {
  silhouette: Buffer; // 0/255 per-pixel
  width: number;
  height: number;
  outerDilatePx: number;
  innerErodePx: number;
}

function buildRingMask(p: RingMaskParams): Buffer {
  const outer = dilate(p.silhouette, p.width, p.height, p.outerDilatePx);
  const inner = erode(p.silhouette, p.width, p.height, p.innerErodePx);
  // ring = outer & !inner
  const ring = Buffer.alloc(p.silhouette.length);
  for (let i = 0; i < ring.length; i++) {
    ring[i] = outer[i] === 255 && inner[i] === 0 ? 255 : 0;
  }
  return ring;
}

/**
 * Build a feathered B/W mask from the difference between the user
 * photo and the deterministic composite.
 *
 * Returns null when the silhouette is unusable (too small or too big).
 */
export async function autoMaskFromComposite(
  input: AutoMaskInput
): Promise<AutoMaskResult | null> {
  const W = Math.max(1, Math.round(input.targetWidth));
  const H = Math.max(1, Math.round(input.targetHeight));
  const dilatePx = input.dilatePx ?? 6;
  const featherPx = input.featherPx ?? 14;

  const [userRaw, compRaw] = await Promise.all([
    toRawAt(input.userImage, W, H),
    toRawAt(input.compositeImage, W, H),
  ]);

  const { mask, count } = diffSilhouette(
    userRaw,
    compRaw,
    PIXEL_DIFF_THRESHOLD
  );
  const ratio = count / (W * H);
  if (ratio < MIN_SILHOUETTE_RATIO || ratio > MAX_SILHOUETTE_RATIO) {
    return null;
  }

  // Category-aware mask building.
  //
  //   - watch / hand-jewelry → ring mask: outer dilate 12 px minus
  //     inner erode 4 px. Product core preserved.
  //   - glasses → moderate dilate, no erosion.
  //   - headwear / clothes / unspecified → legacy full-silhouette mask
  //     dilated by `dilatePx`.
  let dilated: Buffer;
  switch (input.category) {
    case "watch":
    case "hand-jewelry":
      dilated = buildRingMask({
        silhouette: mask,
        width: W,
        height: H,
        outerDilatePx: 12,
        innerErodePx: 4,
      });
      break;
    case "glasses":
      dilated = dilate(mask, W, H, Math.max(dilatePx, 8));
      break;
    case "headwear":
    case "clothes":
    default:
      dilated = dilate(mask, W, H, dilatePx);
      break;
  }

  // Promote the binary mask to a grayscale PNG and run a Gaussian blur
  // to produce the feathered contact band. Sharp's `blur(sigma)` uses
  // sigma in pixels — we approximate kernel radius ≈ 3·sigma.
  // Building a 4-channel RGBA where R=G=B=mask, A=255 keeps the PNG
  // browser-friendly while staying grayscale.
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = dilated[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }

  const sigma = Math.max(0.4, featherPx / 3);
  const buffer = await sharp(rgba, {
    raw: { width: W, height: H, channels: 4 },
  })
    .blur(sigma)
    .png({ compressionLevel: 6 })
    .toBuffer();

  // Re-measure coverage on the feathered output for diagnostics.
  const ch = await sharp(buffer)
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bright = 0;
  for (let i = 0; i < ch.info.width * ch.info.height; i++) {
    if (ch.data[i] >= 25) bright++;
  }
  const coverage = bright / (W * H);

  return { buffer, coverage };
}
