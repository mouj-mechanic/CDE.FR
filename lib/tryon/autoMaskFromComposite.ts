import sharp from "sharp";
import type { CategoryId } from "@/types";
import {
  computeEditableEnergy,
  minEditableRatioFor,
  targetEditableRatioFor,
} from "./maskValidation";

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
  /**
   * Editable-energy ratio (Σ v/255 / N). Canonical metric — matches
   * `validateMaskForCategory`.
   */
  coverage: number;
  /**
   * Diagnostic block exposing the parameters that actually produced
   * this mask. Populated by `ensureMinimumWatchMaskCoverage` so the
   * route can surface them in `debug.maskDebug` for QA.
   */
  debug?: {
    outerDilatePx: number;
    innerErodePx: number;
    featherPx: number;
    expansionAttempts: number;
    brightRatio: number;
    softRatio: number;
    addedContactShadowPatch: boolean;
  };
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

interface BuildMaskAtParams {
  silhouette: Buffer;
  width: number;
  height: number;
  category: CategoryId | undefined;
  outerDilatePx: number;
  innerErodePx: number;
  featherPx: number;
  addContactShadowPatch: boolean;
}

/**
 * Render the BW mask at the given parameters. Returns the encoded PNG
 * buffer + the editable-energy coverage. Pure render — no progressive
 * expansion logic here.
 */
async function renderMaskAt(p: BuildMaskAtParams): Promise<{
  buffer: Buffer;
  coverage: number;
  brightRatio: number;
  softRatio: number;
}> {
  let dilated: Buffer;
  switch (p.category) {
    case "watch":
    case "hand-jewelry":
      dilated = buildRingMask({
        silhouette: p.silhouette,
        width: p.width,
        height: p.height,
        outerDilatePx: p.outerDilatePx,
        innerErodePx: p.innerErodePx,
      });
      break;
    case "glasses":
      dilated = dilate(
        p.silhouette,
        p.width,
        p.height,
        Math.max(p.outerDilatePx, 8)
      );
      break;
    case "headwear":
    case "clothes":
    default:
      dilated = dilate(p.silhouette, p.width, p.height, p.outerDilatePx);
      break;
  }

  // Optional contact-shadow patch under the product silhouette. Used
  // when the ring mask alone is too thin to meet the minimum editable
  // energy. We compute the silhouette bbox + add a soft ellipse under
  // its bottom edge.
  if (p.addContactShadowPatch) {
    addContactShadowToMask(dilated, p.silhouette, p.width, p.height);
  }

  const rgba = Buffer.alloc(p.width * p.height * 4);
  for (let i = 0; i < p.width * p.height; i++) {
    const v = dilated[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const sigma = Math.max(0.4, p.featherPx / 3);
  const buffer = await sharp(rgba, {
    raw: { width: p.width, height: p.height, channels: 4 },
  })
    .blur(sigma)
    .png({ compressionLevel: 6 })
    .toBuffer();

  // Measure editable energy on the feathered output — that's the
  // metric `validateMaskForCategory` uses.
  const stats = await computeEditableEnergy(buffer);
  return {
    buffer,
    coverage: stats.editableEnergyRatio,
    brightRatio: stats.brightRatio,
    softRatio: stats.softRatio,
  };
}

/**
 * Add a soft elliptical patch under the silhouette bbox to widen the
 * editable contact band. Mutates `mask` in place. The patch is drawn
 * as a horizontal capsule whose top sits at the silhouette's bottom
 * edge — that's where the wrist contact shadow naturally lives.
 */
function addContactShadowToMask(
  mask: Buffer,
  silhouette: Buffer,
  w: number,
  h: number
): void {
  // Compute silhouette bbox.
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (silhouette[y * w + x] === 255) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return;
  const cx = (minX + maxX) / 2;
  const cy = maxY + (maxY - minY) * 0.25;
  const rx = (maxX - minX) * 0.55;
  const ry = (maxY - minY) * 0.18;
  if (rx <= 0 || ry <= 0) return;

  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(h - 1, Math.ceil(cy + ry));
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(w - 1, Math.ceil(cx + rx));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const r = dx * dx + dy * dy;
      if (r > 1) continue;
      const v = Math.round(220 * (1 - r * r)); // soft falloff
      const i = y * w + x;
      if (v > mask[i]) mask[i] = v;
    }
  }
}

/**
 * Build a feathered B/W mask from the difference between the user
 * photo and the deterministic composite.
 *
 * Returns null when the silhouette is unusable (too small or too big).
 *
 *  For watch / hand-jewelry, the function progressively widens the
 *  ring until the editable-energy ratio reaches the per-category
 *  minimum (see `MIN_EDITABLE_RATIO_BY_CATEGORY`). It NEVER makes the
 *  product core editable — only the outer ring + an optional contact
 *  shadow patch is expanded. Hard ceiling at the per-category cap.
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

  const { mask: silhouette, count } = diffSilhouette(
    userRaw,
    compRaw,
    PIXEL_DIFF_THRESHOLD
  );
  const ratio = count / (W * H);
  if (ratio < MIN_SILHOUETTE_RATIO || ratio > MAX_SILHOUETTE_RATIO) {
    return null;
  }

  // Single-pass render for categories that don't need auto-expansion.
  if (input.category !== "watch" && input.category !== "hand-jewelry") {
    const rendered = await renderMaskAt({
      silhouette,
      width: W,
      height: H,
      category: input.category,
      outerDilatePx: dilatePx,
      innerErodePx: 0,
      featherPx,
      addContactShadowPatch: false,
    });
    return {
      buffer: rendered.buffer,
      coverage: rendered.coverage,
      debug: {
        outerDilatePx: dilatePx,
        innerErodePx: 0,
        featherPx,
        expansionAttempts: 0,
        brightRatio: rendered.brightRatio,
        softRatio: rendered.softRatio,
        addedContactShadowPatch: false,
      },
    };
  }

  // Watch / hand-jewelry: ensure minimum coverage by progressively
  // widening the outer ring + adding a contact shadow patch.
  return await ensureMinimumWatchMaskCoverage({
    silhouette,
    width: W,
    height: H,
    category: input.category,
  });
}

interface EnsureMinParams {
  silhouette: Buffer;
  width: number;
  height: number;
  category: CategoryId;
}

/**
 * Build a SAFER (tighter, more conservative) mask for the
 * customer-preservation retry path.
 *
 *  When the first OpenAI pass triggers the customer-preservation
 *  gate (i.e. the AI painted too much outside the editable zone), we
 *  re-run OpenAI with a stricter mask that:
 *    - aims for the bottom of the per-category TARGET band (0.5–1.5 %
 *      editable energy for watch instead of 0.8–2.5 %);
 *    - erodes the product core more aggressively (6 px vs 4 px) so
 *      the product cannot be redrawn even if the model tries;
 *    - skips the contact-shadow patch — that's the patch the model
 *      most often overruns into surrounding skin.
 *
 *  Returns null when no usable silhouette exists.
 */
export async function createRetryMaskForCustomerPreservation(input: {
  userImage: Buffer;
  compositeImage: Buffer;
  targetWidth: number;
  targetHeight: number;
  category: CategoryId;
}): Promise<AutoMaskResult | null> {
  const W = Math.max(1, Math.round(input.targetWidth));
  const H = Math.max(1, Math.round(input.targetHeight));

  const [userRaw, compRaw] = await Promise.all([
    toRawAt(input.userImage, W, H),
    toRawAt(input.compositeImage, W, H),
  ]);

  const { mask: silhouette, count } = diffSilhouette(
    userRaw,
    compRaw,
    PIXEL_DIFF_THRESHOLD
  );
  const ratio = count / (W * H);
  if (ratio < MIN_SILHOUETTE_RATIO || ratio > MAX_SILHOUETTE_RATIO) {
    return null;
  }

  // Tight ring config — chosen to ALWAYS stay inside the OpenAI mask
  // coverage cap (≤ 8 % for accessories) and to favour preservation
  // over blending. Used by the customer-preservation retry path
  // *only* — never the initial pass.
  const rendered = await renderMaskAt({
    silhouette,
    width: W,
    height: H,
    category: input.category,
    outerDilatePx: input.category === "watch" ? 10 : 10,
    innerErodePx: input.category === "watch" ? 6 : 5,
    featherPx: 8,
    addContactShadowPatch: false,
  });
  return {
    buffer: rendered.buffer,
    coverage: rendered.coverage,
    debug: {
      outerDilatePx: 10,
      innerErodePx: input.category === "watch" ? 6 : 5,
      featherPx: 8,
      expansionAttempts: 0,
      brightRatio: rendered.brightRatio,
      softRatio: rendered.softRatio,
      addedContactShadowPatch: false,
    },
  };
}

/**
 * Progressively widen the ring mask until its editable-energy ratio is
 * within the per-category target band. Never goes past the hard cap.
 *
 *  Expansion plan (per category):
 *    1. outer = 12, inner = 4, feather = 8        → baseline
 *    2. outer = 16, inner = 4, feather = 10       → slightly wider ring
 *    3. outer = 20, inner = 4, feather = 12       → ring + start blending
 *    4. outer = 24, inner = 5, feather = 12, +contact-patch
 *    5. outer = 28, inner = 5, feather = 14, +contact-patch
 *
 *  The inner erosion is bumped to 5 px on the later passes so the
 *  product core never starts drifting into the editable zone. The
 *  contact-shadow patch sits underneath the silhouette and only
 *  touches skin pixels.
 */
async function ensureMinimumWatchMaskCoverage(
  p: EnsureMinParams
): Promise<AutoMaskResult> {
  const min = minEditableRatioFor(p.category);
  const target = targetEditableRatioFor(p.category);
  const cap =
    p.category === "watch"
      ? 0.12
      : p.category === "hand-jewelry"
        ? 0.14
        : 0.18;

  const plan: Array<{
    outerDilatePx: number;
    innerErodePx: number;
    featherPx: number;
    addContactShadowPatch: boolean;
  }> = [
    { outerDilatePx: 12, innerErodePx: 4, featherPx: 8, addContactShadowPatch: false },
    { outerDilatePx: 16, innerErodePx: 4, featherPx: 10, addContactShadowPatch: false },
    { outerDilatePx: 20, innerErodePx: 4, featherPx: 12, addContactShadowPatch: false },
    { outerDilatePx: 24, innerErodePx: 5, featherPx: 12, addContactShadowPatch: true },
    { outerDilatePx: 28, innerErodePx: 5, featherPx: 14, addContactShadowPatch: true },
  ];

  let last: {
    buffer: Buffer;
    coverage: number;
    brightRatio: number;
    softRatio: number;
  } | null = null;
  let chosen: (typeof plan)[number] = plan[0];

  for (let attempt = 0; attempt < plan.length; attempt++) {
    const cfg = plan[attempt];
    const rendered = await renderMaskAt({
      silhouette: p.silhouette,
      width: p.width,
      height: p.height,
      category: p.category,
      outerDilatePx: cfg.outerDilatePx,
      innerErodePx: cfg.innerErodePx,
      featherPx: cfg.featherPx,
      addContactShadowPatch: cfg.addContactShadowPatch,
    });
    last = rendered;
    chosen = cfg;
    // Hard cap guard — stop early if we'd overshoot.
    if (rendered.coverage >= cap) {
      console.warn(
        `[auto-mask] coverage ${rendered.coverage.toFixed(
          4
        )} reached cap ${cap}, stopping expansion (attempt ${attempt})`
      );
      break;
    }
    if (rendered.coverage >= target.min) {
      return {
        buffer: rendered.buffer,
        coverage: rendered.coverage,
        debug: {
          outerDilatePx: cfg.outerDilatePx,
          innerErodePx: cfg.innerErodePx,
          featherPx: cfg.featherPx,
          expansionAttempts: attempt,
          brightRatio: rendered.brightRatio,
          softRatio: rendered.softRatio,
          addedContactShadowPatch: cfg.addContactShadowPatch,
        },
      };
    }
    // Still below target — try the next configuration.
  }

  // We ran the full expansion plan. Return the last attempt — the
  // route gets to decide whether to use it (likely yes if coverage ≥
  // min) or fall back to the deterministic composite.
  const finalCoverage = last?.coverage ?? 0;
  if (finalCoverage < min) {
    console.warn(
      `[auto-mask] could not reach minimum coverage ${min} for ${p.category}, best=${finalCoverage}`
    );
  }
  return {
    buffer: last?.buffer ?? Buffer.alloc(0),
    coverage: finalCoverage,
    debug: {
      outerDilatePx: chosen.outerDilatePx,
      innerErodePx: chosen.innerErodePx,
      featherPx: chosen.featherPx,
      expansionAttempts: plan.length,
      brightRatio: last?.brightRatio ?? 0,
      softRatio: last?.softRatio ?? 0,
      addedContactShadowPatch: chosen.addContactShadowPatch,
    },
  };
}
