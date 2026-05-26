import sharp from "sharp";
import type { CategoryId } from "@/types";

/**
 * Anti-ghost final compositor for accessory try-on.
 *
 *  Problem this solves:
 *    The AI sometimes paints a "ghost watch" *outside* the area where
 *    the deterministic composite placed the real product (e.g. on the
 *    other wrist, or a faint shadow watch beside the real one). The
 *    standard product-lock re-stamp puts the real product back in the
 *    right spot but does not touch the ghost. Result: two visible
 *    watches.
 *
 *  Strategy — three-source pixel mux:
 *    For every output pixel, we pick from one of three layers:
 *
 *       product core    → deterministicComposite  (real product pixels)
 *       contact ring    → aiResult                (AI shadows/blend)
 *       everything else → userBase                (untouched customer)
 *
 *    The "product core" region is the eroded product silhouette
 *    derived from `deterministicComposite vs userBase` (≥ diff
 *    threshold). The "contact ring" is the editable area from the
 *    integration mask. Pixels outside both fall through to userBase,
 *    so any ghost product the AI drew on the other wrist disappears.
 *
 *  Why not use the alpha mask directly?
 *    The alpha mask used by OpenAI is the integration *ring* — it
 *    deliberately excludes the product core. We need a separate
 *    "product core" mask derived from the diff. We compute both here
 *    in one pass for consistency.
 *
 *  Limits:
 *    - When the AI result extends product pixels slightly past the
 *      deterministic silhouette (legitimate strap wrap), we DO keep
 *      those: they're inside the ring and below the diff threshold
 *      from userBase, so they appear in `aiResult` pixels.
 *    - When the AI swapped the product for a different one in roughly
 *      the same place, our `userBase` doesn't help; the silhouette
 *      diff places those pixels in "product core" and we re-stamp the
 *      original. That's the correct behaviour.
 *    - Clothes are excluded by design.
 */

const PIXEL_DIFF_THRESHOLD = 18;

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

async function toRawRgba(
  buf: Buffer,
  w: number,
  h: number
): Promise<RawImage> {
  const { data, info } = await sharp(buf)
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

function buildProductCoreSilhouette(
  user: RawImage,
  composite: RawImage,
  threshold: number
): { mask: Buffer; count: number } {
  const px = user.width * user.height;
  const mask = Buffer.alloc(px);
  let count = 0;
  for (let i = 0; i < px; i++) {
    const ui = i * user.channels;
    const ci = i * composite.channels;
    const dr = Math.abs(user.data[ui] - composite.data[ci]);
    const dg = Math.abs(user.data[ui + 1] - composite.data[ci + 1]);
    const db = Math.abs(user.data[ui + 2] - composite.data[ci + 2]);
    if ((dr + dg + db) / 3 > threshold) {
      mask[i] = 255;
      count++;
    }
  }
  return { mask, count };
}

/** 4-neighbour binary dilation. */
function dilate(src: Buffer, w: number, h: number, radius: number): Buffer {
  let a: Uint8Array = Uint8Array.from(src);
  let b: Uint8Array = new Uint8Array(src.length);
  for (let r = 0; r < Math.max(0, Math.round(radius)); r++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (a[i] === 255) {
          b[i] = 255;
          continue;
        }
        const l = x > 0 ? a[i - 1] : 0;
        const r2 = x < w - 1 ? a[i + 1] : 0;
        const u = y > 0 ? a[i - w] : 0;
        const d = y < h - 1 ? a[i + w] : 0;
        b[i] = l || r2 || u || d ? 255 : 0;
      }
    }
    const tmp = a;
    a = b;
    b = tmp;
    b.fill(0);
  }
  return Buffer.from(a);
}

export interface ComposeLockedFinalInput {
  /** PNG buffer of the original customer photo (no product). */
  userBase: Buffer;
  /**
   * Deterministic composite (user photo + product placed). This is the
   * source of truth for product pixels.
   */
  deterministicComposite: Buffer;
  /** PNG buffer of the AI result. Contributes the contact/shadow band. */
  aiResult: Buffer;
  category: CategoryId;
  /**
   * Outer dilation in pixels for the "contact band" region. Anything
   * within this distance of the product silhouette is sourced from the
   * AI result so the contact shadows survive. Default 12.
   */
  contactBandPx?: number;
}

export interface ComposeLockedFinalResult {
  /** Final PNG buffer (RGBA). */
  buffer: Buffer;
  width: number;
  height: number;
  /** Ratio of product-core pixels to total pixels. */
  productCoreRatio: number;
  /** Ratio of contact-band pixels to total pixels. */
  contactBandRatio: number;
  /** True when the compositor applied the three-source mux. */
  applied: boolean;
  /** Reason when `applied=false`. */
  skipReason?: string;
}

/**
 * Anti-ghost three-source pixel mux. Always returns a PNG buffer; when
 * the silhouette derivation fails we transparently fall back to the
 * AI result so the caller never has to handle a null.
 */
export async function composeLockedAccessoryFinal(
  input: ComposeLockedFinalInput
): Promise<ComposeLockedFinalResult> {
  if (input.category === "clothes") {
    const meta = await sharp(input.aiResult).metadata();
    return {
      buffer: input.aiResult,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      productCoreRatio: 0,
      contactBandRatio: 0,
      applied: false,
      skipReason: "Clothes do not use the anti-ghost compositor.",
    };
  }

  const aiMeta = await sharp(input.aiResult).metadata();
  const w = aiMeta.width ?? 0;
  const h = aiMeta.height ?? 0;
  if (!w || !h) {
    return {
      buffer: input.aiResult,
      width: 0,
      height: 0,
      productCoreRatio: 0,
      contactBandRatio: 0,
      applied: false,
      skipReason: "AI result has no dimensions.",
    };
  }

  const [userRaw, compRaw, aiRaw] = await Promise.all([
    toRawRgba(input.userBase, w, h),
    toRawRgba(input.deterministicComposite, w, h),
    toRawRgba(input.aiResult, w, h),
  ]);

  const core = buildProductCoreSilhouette(userRaw, compRaw, PIXEL_DIFF_THRESHOLD);
  const coreRatio = core.count / (w * h);
  if (coreRatio < 0.001 || coreRatio > 0.5) {
    return {
      buffer: input.aiResult,
      width: w,
      height: h,
      productCoreRatio: coreRatio,
      contactBandRatio: 0,
      applied: false,
      skipReason:
        coreRatio < 0.001
          ? "Could not detect the product core in the composite."
          : "Product core silhouette is too large to be a valid accessory.",
    };
  }

  // Dilate the product core to get the OUTER edge of the contact ring.
  // The full ring is `contactPx` wide. Inside it we build a soft
  // weight that fades from 1.0 (right next to the core) to 0.0 (at the
  // outer rim) so the user↔AI transition is gradient rather than a
  // hard line — kills the "halo / hard band around the bracelet"
  // effect.
  const contactPx = input.contactBandPx ?? 12;
  const outer = dilate(core.mask, w, h, contactPx);
  // Pre-compute several intermediate dilations to derive a discrete
  // approximation of the distance field for the contact ring. We use
  // 3 bands → weights 0.85 / 0.55 / 0.25.
  const innerBand = dilate(core.mask, w, h, Math.max(2, Math.round(contactPx / 3)));
  const midBand = dilate(core.mask, w, h, Math.max(3, Math.round((contactPx * 2) / 3)));
  const px = w * h;
  let contactCount = 0;
  const out = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const dstOff = i * 4;
    if (core.mask[i] === 255) {
      // product core → composite (real product pixels)
      const off = i * compRaw.channels;
      out[dstOff] = compRaw.data[off];
      out[dstOff + 1] = compRaw.data[off + 1];
      out[dstOff + 2] = compRaw.data[off + 2];
      out[dstOff + 3] = 255;
    } else if (outer[i] === 255) {
      // contact band — soft blend between AI (shadows) and user base.
      // Weight depends on how close we are to the product core:
      //  - innermost band (≤ contactPx/3 away)  → 85% AI
      //  - middle band   (≤ 2·contactPx/3 away) → 55% AI
      //  - outer band    (≤ contactPx away)     → 25% AI
      // This keeps the AI contact shadow where it matters (next to
      // the watch) and lets the original photo dominate at the rim
      // so no halo line appears.
      const aiWeight =
        innerBand[i] === 255 ? 0.85 : midBand[i] === 255 ? 0.55 : 0.25;
      const userWeight = 1 - aiWeight;
      contactCount++;
      const aOff = i * aiRaw.channels;
      const uOff = i * userRaw.channels;
      out[dstOff] = Math.round(
        aiRaw.data[aOff] * aiWeight + userRaw.data[uOff] * userWeight
      );
      out[dstOff + 1] = Math.round(
        aiRaw.data[aOff + 1] * aiWeight + userRaw.data[uOff + 1] * userWeight
      );
      out[dstOff + 2] = Math.round(
        aiRaw.data[aOff + 2] * aiWeight + userRaw.data[uOff + 2] * userWeight
      );
      out[dstOff + 3] = 255;
    } else {
      // outside everything → user base (untouched). This is what kills
      // ghost watches that the AI drew elsewhere.
      const off = i * userRaw.channels;
      out[dstOff] = userRaw.data[off];
      out[dstOff + 1] = userRaw.data[off + 1];
      out[dstOff + 2] = userRaw.data[off + 2];
      out[dstOff + 3] = 255;
    }
  }

  const buffer = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer();

  if (input.category === "watch" || input.category === "hand-jewelry") {
    // [WATCH_ROTATION] trace — `core` is the silhouette of the
    // ROTATED deterministic composite. Its presence guarantees the
    // product core in the final image is the rotated product, not
    // the source PNG. If the watch reads as vertical in the final
    // output, the source must be the geometry, not this compositor.
    console.info("[WATCH_ROTATION] compose-locked-final", {
      category: input.category,
      productCoreRatio: Math.round(coreRatio * 1000) / 1000,
      contactBandRatio: Math.round((contactCount / (w * h)) * 1000) / 1000,
      width: w,
      height: h,
      productCoreSource: "rotated_deterministic_composite",
    });
  }

  return {
    buffer,
    width: w,
    height: h,
    productCoreRatio: coreRatio,
    contactBandRatio: contactCount / (w * h),
    applied: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Ghost detection — independent of the mux above. We sometimes want
//  to *know* whether the AI drew something outside the expected
//  silhouette without yet committing to a fallback (the route picks
//  the strategy).
// ──────────────────────────────────────────────────────────────────────────

export interface GhostDetectionInput {
  userBase: Buffer;
  deterministicComposite: Buffer;
  aiResult: Buffer;
  /**
   * Expected product bbox in *normalised* coordinates (0..1). Anything
   * the AI drew outside the bbox dilated by `bboxPadRatio` is
   * considered a ghost. Default pad: 0.1 (10 % of width/height each
   * side).
   */
  expectedBBox?: { x0: number; y0: number; x1: number; y1: number };
  bboxPadRatio?: number;
}

export interface GhostDetectionResult {
  ghostDetected: boolean;
  ghostRatio: number; // ratio of "AI changed pixels outside expected bbox"
  expectedRatio: number; // ratio of expected silhouette
  reason: string;
}

const DOWNSAMPLE = 128;

export async function detectGhostProductOutsideExpectedSilhouette(
  input: GhostDetectionInput
): Promise<GhostDetectionResult> {
  const [userRaw, compRaw, aiRaw] = await Promise.all([
    toRawRgba(input.userBase, DOWNSAMPLE, DOWNSAMPLE),
    toRawRgba(input.deterministicComposite, DOWNSAMPLE, DOWNSAMPLE),
    toRawRgba(input.aiResult, DOWNSAMPLE, DOWNSAMPLE),
  ]);

  // Compute the expected silhouette from the composite (where the
  // deterministic pipeline put the product). Dilate it a bit so
  // legitimate AI contact shadows don't trigger a false positive.
  const expected = buildProductCoreSilhouette(
    userRaw,
    compRaw,
    PIXEL_DIFF_THRESHOLD
  );
  const expectedDilated = dilate(expected.mask, DOWNSAMPLE, DOWNSAMPLE, 8);

  // Build the AI-vs-user silhouette: every pixel the AI changed.
  const aiSil = buildProductCoreSilhouette(userRaw, aiRaw, PIXEL_DIFF_THRESHOLD);

  // Pixels that the AI changed but that lie OUTSIDE the expected
  // silhouette ⇒ candidate ghost pixels.
  let ghostPx = 0;
  const total = DOWNSAMPLE * DOWNSAMPLE;
  for (let i = 0; i < total; i++) {
    if (aiSil.mask[i] === 255 && expectedDilated[i] === 0) ghostPx++;
  }
  const ghostRatio = ghostPx / total;
  const expectedRatio = expected.count / total;

  // A ghost is real when it covers at least 1 % of the image OR at
  // least 30 % of the expected silhouette ratio. The 30 % rule
  // catches small but conspicuous secondary watches on tightly framed
  // photos.
  const ghostDetected =
    ghostRatio > 0.01 ||
    (expectedRatio > 0.005 && ghostRatio > expectedRatio * 0.3);

  return {
    ghostDetected,
    ghostRatio,
    expectedRatio,
    reason: ghostDetected
      ? `AI drew ${(ghostRatio * 100).toFixed(
          1
        )}% of pixels outside the expected product silhouette (${(
          expectedRatio * 100
        ).toFixed(1)}%).`
      : "No ghost product detected.",
  };
  // expectedBBox / bboxPadRatio reserved for future strict bbox
  // bounding; the silhouette-based version above already catches the
  // common cases.
  void input.expectedBBox;
  void input.bboxPadRatio;
}
