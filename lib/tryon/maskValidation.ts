import sharp from "sharp";
import type { CategoryId, TryOnWarning } from "@/types";

/**
 * Validate the user-supplied mask against the base image and surface
 * category-specific guidance.
 *
 *  Inputs:
 *    - bwMaskBuf: PNG, white = editable, black = preserved.
 *    - baseDims:  the base image's width/height (already known by caller).
 *    - category:  the try-on category — drives the upper bound on the
 *                 white-area ratio and the human-readable advice.
 *
 *  Outputs:
 *    { ok, error, warnings, whiteAreaRatio, dimensions }
 *
 *  - `ok=false + error` blocks the request (HTTP 400 caller-side).
 *  - `warnings` are non-blocking; they are forwarded to the response so
 *    operators can act on them.
 */

/**
 * Max ratio of white (editable) pixels to total pixels.
 *
 * Tightened compared to the first pass: with the product-lock pipeline
 * the mask only needs to cover the contact band around the product
 * (shadows, blending). A 25% mask would mean we are asking the AI to
 * touch a quarter of the customer image — way too much.
 */
export const MAX_WHITE_RATIO_ACCESSORY = 0.25; // watch/glasses/headwear/hand-jewelry
export const MAX_WHITE_RATIO_CLOTHES = 0.7;
export const MIN_WHITE_RATIO = 0.005;

export interface MaskValidationResult {
  ok: boolean;
  error?: string;
  warnings: TryOnWarning[];
  whiteAreaRatio: number;
  dimensions: { width: number; height: number };
}

function maxWhiteRatioFor(category: CategoryId): number {
  return category === "clothes"
    ? MAX_WHITE_RATIO_CLOTHES
    : MAX_WHITE_RATIO_ACCESSORY;
}

const ADVICE: Record<CategoryId, string> = {
  watch:
    "Mask should focus on the wrist / product contact area only — do not cover fingers or the full hand.",
  glasses:
    "Mask should focus on eyes, nose bridge, frame, and temples — do not cover the mouth or full face.",
  headwear:
    "Mask should focus on the headwear area / top of head — do not cover the full face.",
  "hand-jewelry":
    "Mask should focus on a single finger segment (ring) or the wrist area (bracelet) — do not cover the whole hand.",
  clothes:
    "Mask should cover the garment area only — avoid face, hair, and hands when possible.",
};

/**
 * Compute the ratio of fully-white pixels to total pixels.
 *
 *  We use a luminance threshold (>= 200) rather than strict 255 so masks
 *  exported with anti-aliased edges still count their bright interior as
 *  "editable". The opposite goes for black: anything <= 50 counts as
 *  preserved. Pixels in between are blend / feather pixels — we count
 *  them as half toward the white ratio.
 */
async function computeWhiteRatio(maskBuf: Buffer): Promise<{
  ratio: number;
  width: number;
  height: number;
}> {
  const { data, info } = await sharp(maskBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = info.width * info.height;
  let whitePixels = 0;
  let featherPixels = 0;
  for (let i = 0; i < px; i++) {
    const v = data[i * info.channels]; // R channel (grayscale)
    if (v >= 200) whitePixels++;
    else if (v >= 50) featherPixels++;
  }
  const ratio = (whitePixels + featherPixels * 0.5) / px;
  return { ratio, width: info.width, height: info.height };
}

export async function validateMaskForCategory(
  maskBuf: Buffer,
  baseDims: { width: number; height: number },
  category: CategoryId
): Promise<MaskValidationResult> {
  const warnings: TryOnWarning[] = [];

  // 1. Dimension match — early out, the route already pre-flights this
  //    but we duplicate here so the helper is self-contained.
  let stats: { ratio: number; width: number; height: number };
  try {
    stats = await computeWhiteRatio(maskBuf);
  } catch (err) {
    return {
      ok: false,
      error: `Mask is unreadable: ${
        err instanceof Error ? err.message : String(err)
      }.`,
      warnings,
      whiteAreaRatio: 0,
      dimensions: { width: 0, height: 0 },
    };
  }

  if (stats.width !== baseDims.width || stats.height !== baseDims.height) {
    return {
      ok: false,
      error: `Mask dimensions do not match the base image (base ${baseDims.width}x${baseDims.height} vs mask ${stats.width}x${stats.height}).`,
      warnings,
      whiteAreaRatio: stats.ratio,
      dimensions: { width: stats.width, height: stats.height },
    };
  }

  // 2. White-area ratio bounds.
  if (stats.ratio < MIN_WHITE_RATIO) {
    return {
      ok: false,
      error:
        "Mask is too small. The white (editable) area is below 0.5% of the image.",
      warnings,
      whiteAreaRatio: stats.ratio,
      dimensions: { width: stats.width, height: stats.height },
    };
  }

  const cap = maxWhiteRatioFor(category);
  if (stats.ratio > cap) {
    return {
      ok: false,
      error: `Mask covers ${Math.round(
        stats.ratio * 100
      )}% of the image (max ${Math.round(
        cap * 100
      )}% for ${category}). Customer identity may change. Tighten the mask.`,
      warnings,
      whiteAreaRatio: stats.ratio,
      dimensions: { width: stats.width, height: stats.height },
    };
  }

  // 3. Soft warnings — close to bounds.
  if (stats.ratio > cap * 0.8) {
    warnings.push({
      code: "mask-too-large",
      message: "Mask covers too much of the image. Customer identity may change.",
    });
  }
  if (stats.ratio < MIN_WHITE_RATIO * 4) {
    warnings.push({
      code: "mask-too-small",
      message: "Mask is too small. Product may not blend correctly.",
    });
  }

  // 4. Category-specific advice — always emitted, kept friendly.
  warnings.push({
    code: `mask-advice-${category}`,
    message: ADVICE[category],
  });

  return {
    ok: true,
    warnings,
    whiteAreaRatio: stats.ratio,
    dimensions: { width: stats.width, height: stats.height },
  };
}
