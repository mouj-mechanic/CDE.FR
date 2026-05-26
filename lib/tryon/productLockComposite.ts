import sharp from "sharp";
import type { CategoryId } from "@/types";

/**
 * Product-lock compositing — the second leg of the strict-fidelity pipeline.
 *
 *  Why?
 *    GPT Image is great at integrating a product into a scene (shadows,
 *    contact, lighting) but consistently re-draws the product itself —
 *    changing dial details on a watch, recoloring a glasses frame,
 *    reshaping a ring band, etc. For e-commerce that is not
 *    acceptable. The product MUST stay visually faithful to the
 *    reference.
 *
 *  How?
 *    1. Client renders a deterministic composite of (user photo + the
 *       original transparent product PNG at the chosen placement).
 *    2. Client builds a tight contact-band mask around that placement.
 *    3. Server resizes both to the OpenAI output size and calls GPT
 *       Image with the composite as the base + the alpha mask. The
 *       prompt says "the product is already locked, only integrate".
 *    4. After GPT Image returns, this function detects the *product
 *       silhouette* by diffing the user photo and the composite
 *       (significant pixel difference = product was rendered there),
 *       then re-stamps the composite's product pixels on top of the
 *       AI result through that silhouette. The result is the AI
 *       integration *plus* the original, untouched product pixels.
 *
 *  Why diff-based silhouette and not an explicit alpha map?
 *    - Zero client-side change. The client already produces the
 *      composite for refinement; we simply derive the silhouette from
 *      it.
 *    - The composite was rendered atop the user photo, so the only
 *      pixels that differ are exactly the product pixels (plus a
 *      ~1-px anti-aliased edge). Even feathered shadows usually
 *      stay below the difference threshold and naturally fall outside
 *      the silhouette so the AI's contact shadows survive.
 *
 *  Limitations:
 *    - Areas where the product color is identical to the underlying
 *      skin/background slip below the diff threshold. We tighten the
 *      threshold (PIXEL_DIFF_THRESHOLD) and dilate the silhouette by
 *      one pixel to mitigate.
 *    - Clothes are excluded by design (garments must deform to the
 *      body — re-stamping the original PNG breaks fit).
 *    - Headwear behaves like the other accessories.
 *
 *  All inputs/outputs are PNG to preserve alpha. JPEG is never used.
 */

/**
 * Maximum mean per-pixel RGB difference (0..255) considered "background".
 * Anything above this is treated as "product was rendered here".
 *
 * Tuned empirically: 18 catches typical anti-aliased edges without
 * dragging skin shadows into the silhouette. Override via env if a
 * specific deployment needs more or less aggressive masking.
 */
const PIXEL_DIFF_THRESHOLD = (() => {
  const raw = process.env.OPENAI_PRODUCT_LOCK_DIFF_THRESHOLD?.trim();
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v > 0 && v < 255 ? v : 18;
})();

/**
 * Minimum silhouette ratio to consider the lock "successful".
 * 0.001 = 0.1% of the image. Below that we assume the diff failed
 * (e.g. composite identical to user photo) and refuse to claim the
 * product was locked.
 */
const MIN_SILHOUETTE_RATIO = 0.001;

/**
 * Maximum silhouette ratio. Above that we suspect the composite is not
 * a real composite (e.g. drastically different image) and refuse the
 * lock. Capped at 60% — accessories never cover that much of the frame.
 */
const MAX_SILHOUETTE_RATIO = 0.6;

export type ProductFidelityMode =
  /** AI-only edit, no product re-stamp (clothes / fallback). */
  | "ai-only"
  /** AI edit + original product PNG re-stamped (accessories). */
  | "locked-overlay-after-ai"
  /** Lock attempted but the silhouette was unusable. */
  | "locked-overlay-skipped";

export interface CompositeLockedProductInput {
  /** PNG returned by OpenAI image edit (any size). */
  baseImageAfterAI: Buffer;
  /** Composite sent to OpenAI (user photo + product placed). */
  compositeBeforeAI: Buffer;
  /** Original user photo (no product). */
  userBaseImage: Buffer;
  category: CategoryId;
  /**
   * Optional pre-rendered alpha map of the product silhouette. If set,
   * skips the diff step and uses the alpha directly. Reserved for
   * future client-side enhancements.
   */
  productAlpha?: Buffer;
}

export interface CompositeLockedProductResult {
  /** PNG with the original product re-applied on top of the AI result. */
  buffer: Buffer;
  /** Final image dimensions. */
  width: number;
  height: number;
  /** Ratio of silhouette pixels to total pixels (0..1). */
  silhouetteRatio: number;
  /** True when the lock actually applied (silhouette in valid range). */
  productLocked: boolean;
  productFidelityMode: ProductFidelityMode;
  /** Human-readable reason when productLocked=false. */
  skipReason?: string;
}

export class ProductLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductLockError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Internals
// ──────────────────────────────────────────────────────────────────────────

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

async function toRawRgba(
  buf: Buffer,
  width: number,
  height: number
): Promise<RawImage> {
  const { data, info } = await sharp(buf)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
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

/**
 * Compute a binary silhouette by diffing two same-sized RGBA buffers.
 *  Returns:
 *   - silhouette: 0/255 alpha buffer (255 = product pixel).
 *   - count: number of silhouette pixels.
 *   - ratio: count / (w*h).
 */
function silhouetteFromDiff(
  user: RawImage,
  composite: RawImage,
  threshold: number
): { silhouette: Buffer; count: number; ratio: number } {
  if (
    user.width !== composite.width ||
    user.height !== composite.height
  ) {
    throw new ProductLockError(
      `Internal error: silhouette diff inputs disagree on size (${user.width}x${user.height} vs ${composite.width}x${composite.height}).`
    );
  }
  const w = user.width;
  const h = user.height;
  const px = w * h;
  const out = Buffer.alloc(px);
  let count = 0;

  for (let i = 0; i < px; i++) {
    const ua = user.channels === 4 ? user.data[i * 4 + 3] : 255;
    const ca = composite.channels === 4 ? composite.data[i * 4 + 3] : 255;
    // If composite has transparent pixels but user is opaque, diff is
    // already 100% — handle directly.
    if (ca < 32 && ua >= 200) {
      // unlikely path; treat as "no product"
      continue;
    }
    const ur = user.data[i * user.channels];
    const ug = user.data[i * user.channels + 1];
    const ub = user.data[i * user.channels + 2];
    const cr = composite.data[i * composite.channels];
    const cg = composite.data[i * composite.channels + 1];
    const cb = composite.data[i * composite.channels + 2];
    const dr = Math.abs(ur - cr);
    const dg = Math.abs(ug - cg);
    const db = Math.abs(ub - cb);
    const diff = (dr + dg + db) / 3;
    if (diff > threshold) {
      out[i] = 255;
      count++;
    }
  }
  return { silhouette: out, count, ratio: count / px };
}

/**
 * One-pixel binary dilation. Pads the silhouette by one pixel so the
 * re-stamped product covers anti-aliased edges that fell below the
 * diff threshold. Cheap; we only run it once.
 */
function dilateOnce(mask: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] === 255) {
        out[i] = 255;
        continue;
      }
      const left = x > 0 ? mask[i - 1] : 0;
      const right = x < w - 1 ? mask[i + 1] : 0;
      const up = y > 0 ? mask[i - w] : 0;
      const down = y < h - 1 ? mask[i + w] : 0;
      out[i] = left || right || up || down ? 255 : 0;
    }
  }
  return out;
}

/**
 * Stamp the composite's pixels (where silhouette = 255) on top of the
 * AI result (where silhouette = 0). Output is a fully opaque RGBA
 * buffer ready to be encoded as PNG.
 */
function stampProduct(
  ai: RawImage,
  composite: RawImage,
  silhouette: Buffer
): Buffer {
  const w = ai.width;
  const h = ai.height;
  const px = w * h;
  const out = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const isProduct = silhouette[i] === 255;
    const src = isProduct ? composite : ai;
    const off = i * src.channels;
    const dst = i * 4;
    out[dst] = src.data[off];
    out[dst + 1] = src.data[off + 1];
    out[dst + 2] = src.data[off + 2];
    out[dst + 3] = 255;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compose the AI-edited image as the background and re-stamp the
 * original transparent product layer on top, preserving its colour and
 * details exactly. The output is always PNG.
 */
export async function compositeLockedProduct(
  input: CompositeLockedProductInput
): Promise<CompositeLockedProductResult> {
  // Clothes never go through the product-lock pipeline — the garment
  // legitimately changes shape and we'd corrupt the AI's fit work.
  if (input.category === "clothes") {
    return {
      buffer: input.baseImageAfterAI,
      width: 0,
      height: 0,
      silhouetteRatio: 0,
      productLocked: false,
      productFidelityMode: "ai-only",
      skipReason: "Product-lock is not applied to clothes by design.",
    };
  }

  // Pull the AI result's actual dimensions — that's our canvas.
  const aiMeta = await sharp(input.baseImageAfterAI).metadata();
  const w = aiMeta.width ?? 0;
  const h = aiMeta.height ?? 0;
  if (!w || !h) {
    throw new ProductLockError(
      "Could not read AI result dimensions for product lock."
    );
  }

  const [aiRaw, compRaw, userRaw] = await Promise.all([
    toRawRgba(input.baseImageAfterAI, w, h),
    toRawRgba(input.compositeBeforeAI, w, h),
    toRawRgba(input.userBaseImage, w, h),
  ]);

  // 1. Build the silhouette.
  let silhouette: Buffer;
  let ratio: number;
  if (input.productAlpha) {
    // Path: client provided an explicit alpha map. Threshold at 128 to
    // get a binary silhouette.
    const alpha = await sharp(input.productAlpha)
      .resize(w, h, { fit: "fill" })
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    silhouette = Buffer.alloc(alpha.length);
    let count = 0;
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] >= 128) {
        silhouette[i] = 255;
        count++;
      }
    }
    ratio = count / (w * h);
  } else {
    // Path: derive from composite-vs-user diff.
    const diff = silhouetteFromDiff(userRaw, compRaw, PIXEL_DIFF_THRESHOLD);
    silhouette = diff.silhouette;
    ratio = diff.ratio;
  }

  // 2. Validate silhouette range.
  if (ratio < MIN_SILHOUETTE_RATIO) {
    return {
      buffer: input.baseImageAfterAI,
      width: w,
      height: h,
      silhouetteRatio: ratio,
      productLocked: false,
      productFidelityMode: "locked-overlay-skipped",
      skipReason:
        "Could not detect the product silhouette in the composite (it may be identical to the user photo).",
    };
  }
  if (ratio > MAX_SILHOUETTE_RATIO) {
    return {
      buffer: input.baseImageAfterAI,
      width: w,
      height: h,
      silhouetteRatio: ratio,
      productLocked: false,
      productFidelityMode: "locked-overlay-skipped",
      skipReason: `Product silhouette ratio ${ratio.toFixed(
        3
      )} exceeds ${MAX_SILHOUETTE_RATIO} — refusing to re-stamp at this scale.`,
    };
  }

  // 3. Dilate by one pixel to cover anti-aliased edges.
  const dilated = dilateOnce(silhouette, w, h);

  // 4. Stamp.
  const stamped = stampProduct(aiRaw, compRaw, dilated);

  // 5. Encode PNG (preserves alpha cleanly even though stamped is opaque).
  const buffer = await sharp(stamped, {
    raw: { width: w, height: h, channels: 4 },
  })
    .png({ compressionLevel: 6 })
    .toBuffer();

  return {
    buffer,
    width: w,
    height: h,
    silhouetteRatio: ratio,
    productLocked: true,
    productFidelityMode: "locked-overlay-after-ai",
  };
}

/**
 * Read the OPENAI_PRODUCT_LOCK env flag once. Defaults to true so the
 * pipeline is on by default; operators can opt out for QA / A-B tests.
 */
export function isProductLockEnabled(): boolean {
  const raw = process.env.OPENAI_PRODUCT_LOCK?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw !== "false" && raw !== "0";
}
