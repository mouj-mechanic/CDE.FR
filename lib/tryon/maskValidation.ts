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
/**
 * Per-category mask coverage caps.
 *
 *  Watch + hand-jewelry are extremely identity-sensitive: the mask
 *  should cover only the watch case + a thin contact band on the
 *  wrist, never fingers or the back of the hand. Empirically, anything
 *  past ~18 % of the image starts to "eat" surrounding skin and the
 *  AI starts inventing finger anatomy.
 *
 *  Glasses and headwear can be slightly larger because they sit on
 *  features that are tolerant to small alterations (eyebrows, hair).
 */
export const MAX_WHITE_RATIO_WATCH = 0.12;
export const MAX_WHITE_RATIO_HAND_JEWELRY = 0.18;
export const MAX_WHITE_RATIO_GLASSES = 0.22;
export const MAX_WHITE_RATIO_HEADWEAR = 0.3;
export const MAX_WHITE_RATIO_CLOTHES = 0.7;

/**
 * Per-category MINIMUM editable energy ratios.
 *
 *  The previous global `MIN_WHITE_RATIO = 0.005` (0.5 %) was too high
 *  for the new contact-only ring mask. A ring of 12–16 px around a
 *  small wrist watch silhouette has total bright area well under 0.5 %
 *  of a 1024×1536 image, especially after Gaussian feather (which
 *  spreads pixels across the [50..200] range — counted as "soft").
 *
 *  We now use `computeEditableEnergy` (a weighted sum of v/255) so the
 *  feathered band counts properly, and we lower the floor per
 *  category.
 */
const MIN_EDITABLE_RATIO_BY_CATEGORY: Record<CategoryId, number> = {
  watch: 0.0035,
  "hand-jewelry": 0.003,
  glasses: 0.006,
  headwear: 0.008,
  clothes: 0.02,
};

/**
 * Per-category TARGET editable energy ratios.
 *
 *  Informational only — used by the auto-expansion logic in
 *  `autoMaskFromComposite` to decide when to stop widening the ring.
 *  When the energy ratio lands inside this band, no further widening
 *  is attempted.
 */
const TARGET_EDITABLE_RATIO_BY_CATEGORY: Record<
  CategoryId,
  { min: number; max: number }
> = {
  watch: { min: 0.008, max: 0.025 },
  "hand-jewelry": { min: 0.006, max: 0.025 },
  glasses: { min: 0.015, max: 0.05 },
  headwear: { min: 0.02, max: 0.08 },
  clothes: { min: 0.25, max: 0.55 },
};

export const MIN_WHITE_RATIO = MIN_EDITABLE_RATIO_BY_CATEGORY.watch;

export function minEditableRatioFor(category: CategoryId): number {
  return MIN_EDITABLE_RATIO_BY_CATEGORY[category];
}

export function targetEditableRatioFor(category: CategoryId): {
  min: number;
  max: number;
} {
  return TARGET_EDITABLE_RATIO_BY_CATEGORY[category];
}

export interface MaskValidationResult {
  ok: boolean;
  /**
   * Stable error code so the route can decide whether to retry / fall
   * back without parsing the message.
   */
  errorCode?: "mask-too-small" | "mask-too-large" | "mask-dimension" | "mask-unreadable";
  error?: string;
  warnings: TryOnWarning[];
  /**
   * Legacy white-pixel ratio (>=200). Kept for backwards compat. Use
   * `editableEnergyRatio` for new decisions.
   */
  whiteAreaRatio: number;
  /**
   * Weighted editable energy ratio in [0..1]. Sums v/255 across all
   * pixels divided by total pixel count. Correctly counts feathered
   * masks that the previous threshold-based logic missed.
   */
  editableEnergyRatio: number;
  /** Ratio of pixels with v >= 200 (the strict "white" core). */
  brightRatio: number;
  /** Ratio of pixels with 50 <= v < 200 (the feather band). */
  softRatio: number;
  dimensions: { width: number; height: number };
}

function maxWhiteRatioFor(category: CategoryId): number {
  switch (category) {
    case "watch":
      return MAX_WHITE_RATIO_WATCH;
    case "hand-jewelry":
      return MAX_WHITE_RATIO_HAND_JEWELRY;
    case "glasses":
      return MAX_WHITE_RATIO_GLASSES;
    case "headwear":
      return MAX_WHITE_RATIO_HEADWEAR;
    case "clothes":
      return MAX_WHITE_RATIO_CLOTHES;
  }
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
 * Compute the editable-energy ratio of a grayscale mask.
 *
 *  Old behaviour (threshold-based): counted v ≥ 200 as 1.0 and
 *  50 ≤ v < 200 as 0.5. That heuristic underestimated soft / feathered
 *  masks by 30–60 % — the new contact-only ring mask is mostly in the
 *  60..160 range after Gaussian blur, so its measured ratio routinely
 *  fell under the 0.5 % floor even though the visible band was
 *  perfectly usable.
 *
 *  New behaviour: `editableEnergy = Σ (v / 255) / N` — a continuous
 *  measure that matches how OpenAI's alpha mask consumes the gradient.
 *  We also report the legacy brightRatio / softRatio for diagnostics.
 *
 *  Returns:
 *    - editableEnergyRatio: weighted sum (canonical metric)
 *    - brightRatio: ratio of pixels with v >= 200
 *    - softRatio:   ratio of pixels with 50 <= v < 200
 *    - width / height of the mask
 */
export async function computeEditableEnergy(maskBuf: Buffer): Promise<{
  editableEnergyRatio: number;
  brightRatio: number;
  softRatio: number;
  width: number;
  height: number;
}> {
  const { data, info } = await sharp(maskBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = info.width * info.height;
  let energy = 0;
  let bright = 0;
  let soft = 0;
  for (let i = 0; i < px; i++) {
    const v = data[i * info.channels]; // R channel (grayscale)
    energy += v / 255;
    if (v >= 200) bright++;
    else if (v >= 50) soft++;
  }
  return {
    editableEnergyRatio: energy / px,
    brightRatio: bright / px,
    softRatio: soft / px,
    width: info.width,
    height: info.height,
  };
}

export async function validateMaskForCategory(
  maskBuf: Buffer,
  baseDims: { width: number; height: number },
  category: CategoryId
): Promise<MaskValidationResult> {
  const warnings: TryOnWarning[] = [];

  let stats: Awaited<ReturnType<typeof computeEditableEnergy>>;
  try {
    stats = await computeEditableEnergy(maskBuf);
  } catch (err) {
    return {
      ok: false,
      errorCode: "mask-unreadable",
      error: `Mask is unreadable: ${
        err instanceof Error ? err.message : String(err)
      }.`,
      warnings,
      whiteAreaRatio: 0,
      editableEnergyRatio: 0,
      brightRatio: 0,
      softRatio: 0,
      dimensions: { width: 0, height: 0 },
    };
  }

  if (stats.width !== baseDims.width || stats.height !== baseDims.height) {
    return {
      ok: false,
      errorCode: "mask-dimension",
      error: `Mask dimensions do not match the base image (base ${baseDims.width}x${baseDims.height} vs mask ${stats.width}x${stats.height}).`,
      warnings,
      whiteAreaRatio: stats.brightRatio,
      editableEnergyRatio: stats.editableEnergyRatio,
      brightRatio: stats.brightRatio,
      softRatio: stats.softRatio,
      dimensions: { width: stats.width, height: stats.height },
    };
  }

  // Editable energy gate. Per-category MIN. This is the authoritative
  // signal — old `whiteAreaRatio` is kept on the result for legacy
  // dashboards but no longer drives the decision.
  const minEnergy = minEditableRatioFor(category);
  if (stats.editableEnergyRatio < minEnergy) {
    return {
      ok: false,
      errorCode: "mask-too-small",
      // Internal-only message. The route catches this code and either
      // regenerates a wider mask or falls back to the deterministic
      // composite — the customer NEVER sees this text.
      error: `Internal auto-mask coverage is too small (editable energy ${(
        stats.editableEnergyRatio * 100
      ).toFixed(3)}% < ${(minEnergy * 100).toFixed(3)}% for ${category}).`,
      warnings,
      whiteAreaRatio: stats.brightRatio,
      editableEnergyRatio: stats.editableEnergyRatio,
      brightRatio: stats.brightRatio,
      softRatio: stats.softRatio,
      dimensions: { width: stats.width, height: stats.height },
    };
  }

  const cap = maxWhiteRatioFor(category);
  if (stats.editableEnergyRatio > cap) {
    return {
      ok: false,
      errorCode: "mask-too-large",
      error: `Mask covers ${Math.round(
        stats.editableEnergyRatio * 100
      )}% of the image (max ${Math.round(
        cap * 100
      )}% for ${category}). Customer identity may change.`,
      warnings,
      whiteAreaRatio: stats.brightRatio,
      editableEnergyRatio: stats.editableEnergyRatio,
      brightRatio: stats.brightRatio,
      softRatio: stats.softRatio,
      dimensions: { width: stats.width, height: stats.height },
    };
  }

  // Soft warnings — close to bounds.
  if (stats.editableEnergyRatio > cap * 0.8) {
    warnings.push({
      code: "mask-too-large",
      message: "Mask covers too much of the image. Customer identity may change.",
    });
  }

  // Category-specific advice — always emitted, kept friendly.
  warnings.push({
    code: `mask-advice-${category}`,
    message: ADVICE[category],
  });

  return {
    ok: true,
    warnings,
    whiteAreaRatio: stats.brightRatio,
    editableEnergyRatio: stats.editableEnergyRatio,
    brightRatio: stats.brightRatio,
    softRatio: stats.softRatio,
    dimensions: { width: stats.width, height: stats.height },
  };
}
