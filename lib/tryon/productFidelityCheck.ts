import sharp from "sharp";
import type { CategoryId } from "@/types";

/**
 * Post-generation product fidelity check.
 *
 *  Compares the *product region* of the AI result against the same
 *  region of the deterministic composite to detect blatant identity
 *  drift:
 *    - dominant-color shift (e.g. black watch → silver watch)
 *    - silhouette area drift (the AI shrunk / enlarged the product)
 *
 *  This is intentionally a coarse, fast check. It runs on a 96×96
 *  downsample of both images and the silhouette. The goal is not
 *  perceptual quality grading — only to catch the cases where the
 *  model swapped the product for a different one and we should either
 *  retry with a stricter prompt or fall back to the deterministic
 *  composite.
 *
 *  Inputs are expected to already share dimensions (i.e. the OpenAI
 *  output size).
 */

const DOWNSAMPLE = 96;
const DOMINANT_COLOR_DELTA_THRESHOLD = 60; // mean ΔRGB in [0..255]
const SILHOUETTE_RATIO_DRIFT = 0.4; // result silhouette must stay within ±40%

/**
 * Category-aware overrides. Watches and hand-jewelry have a small,
 * high-detail silhouette where any colour shift is immediately
 * visible, so we tighten both gates.
 */
function thresholdsFor(category: CategoryId | undefined): {
  colorDeltaMax: number;
  silhouetteDriftMax: number;
} {
  switch (category) {
    case "watch":
      return { colorDeltaMax: 38, silhouetteDriftMax: 0.3 };
    case "hand-jewelry":
      return { colorDeltaMax: 42, silhouetteDriftMax: 0.35 };
    case "glasses":
      return { colorDeltaMax: 45, silhouetteDriftMax: 0.35 };
    case "headwear":
      return { colorDeltaMax: 55, silhouetteDriftMax: 0.4 };
    default:
      return {
        colorDeltaMax: DOMINANT_COLOR_DELTA_THRESHOLD,
        silhouetteDriftMax: SILHOUETTE_RATIO_DRIFT,
      };
  }
}

export interface ProductFidelityInput {
  /** PNG buffer of the AI result, sized to the OpenAI output dims. */
  aiResult: Buffer;
  /** PNG buffer of the deterministic composite at the same dims. */
  composite: Buffer;
  /** PNG buffer of the user image (no product) at the same dims. */
  userBase: Buffer;
  /** Optional override of the silhouette diff threshold (RGB mean). */
  diffThreshold?: number;
  /**
   * Category. Used to apply tighter thresholds for accessories where
   * any colour drift is visible (watch, glasses, jewelry).
   */
  category?: CategoryId;
}

export interface ProductFidelityResult {
  /** Mean RGB color of the product region in the composite. */
  compositeMeanRGB: [number, number, number];
  /** Mean RGB color of the product region in the AI result. */
  resultMeanRGB: [number, number, number];
  /** Mean absolute RGB delta between the two means (0..255). */
  colorDelta: number;
  /** Silhouette area ratio in [0..1] (composite). */
  compositeSilhouetteRatio: number;
  /** Silhouette area ratio in [0..1] (AI result). */
  resultSilhouetteRatio: number;
  /**
   * True when the result silhouette and composite silhouette stay
   * within ±SILHOUETTE_RATIO_DRIFT of each other.
   */
  silhouetteRatioOk: boolean;
  /**
   * True when the colour delta is below DOMINANT_COLOR_DELTA_THRESHOLD.
   */
  colorOk: boolean;
  /**
   * True when both checks pass. The caller treats `false` as a
   * `qualityCheckFailed=true` signal.
   */
  passed: boolean;
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

async function rawAtSize(src: Buffer, dim: number): Promise<Raw> {
  const { data, info } = await sharp(src)
    .resize(dim, dim, { fit: "fill", kernel: "lanczos3" })
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

function buildSilhouetteMask(
  user: Raw,
  composite: Raw,
  threshold: number
): { mask: Uint8Array; count: number } {
  const px = user.width * user.height;
  const mask = new Uint8Array(px);
  let count = 0;
  for (let i = 0; i < px; i++) {
    const ui = i * user.channels;
    const ci = i * composite.channels;
    const dr = Math.abs(user.data[ui] - composite.data[ci]);
    const dg = Math.abs(user.data[ui + 1] - composite.data[ci + 1]);
    const db = Math.abs(user.data[ui + 2] - composite.data[ci + 2]);
    if ((dr + dg + db) / 3 > threshold) {
      mask[i] = 1;
      count++;
    }
  }
  return { mask, count };
}

function meanColorWithinMask(
  img: Raw,
  mask: Uint8Array,
  flippedThreshold = 0
): { r: number; g: number; b: number; count: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] <= flippedThreshold) continue;
    const idx = i * img.channels;
    r += img.data[idx];
    g += img.data[idx + 1];
    b += img.data[idx + 2];
    n++;
  }
  if (n === 0) return { r: 0, g: 0, b: 0, count: 0 };
  return { r: r / n, g: g / n, b: b / n, count: n };
}

/**
 * Run the fidelity check. Returns counts + booleans; the caller
 * decides whether to fall back to the composite or retry the AI.
 */
export async function checkProductFidelity(
  input: ProductFidelityInput
): Promise<ProductFidelityResult> {
  const threshold = input.diffThreshold ?? 18;
  const [userRaw, compRaw, resultRaw] = await Promise.all([
    rawAtSize(input.userBase, DOWNSAMPLE),
    rawAtSize(input.composite, DOWNSAMPLE),
    rawAtSize(input.aiResult, DOWNSAMPLE),
  ]);

  const compSilhouette = buildSilhouetteMask(userRaw, compRaw, threshold);
  const resultSilhouette = buildSilhouetteMask(userRaw, resultRaw, threshold);
  const totalPx = DOWNSAMPLE * DOWNSAMPLE;
  const compositeRatio = compSilhouette.count / totalPx;
  const resultRatio = resultSilhouette.count / totalPx;

  // Use the composite silhouette as the canonical "product region".
  // That's the area where the placement put the product. If the AI
  // moved the product, the comparison is performed on the *intended*
  // location, which is the correct semantics.
  const compMean = meanColorWithinMask(compRaw, compSilhouette.mask);
  const resultMean = meanColorWithinMask(resultRaw, compSilhouette.mask);

  const colorDelta =
    (Math.abs(compMean.r - resultMean.r) +
      Math.abs(compMean.g - resultMean.g) +
      Math.abs(compMean.b - resultMean.b)) /
    3;

  const { colorDeltaMax, silhouetteDriftMax } = thresholdsFor(input.category);
  const colorOk = colorDelta <= colorDeltaMax;

  // Silhouette area check. If the composite silhouette is so small it's
  // unreliable, skip the check (treat as passed).
  let silhouetteRatioOk = true;
  if (compositeRatio > 0.005) {
    const drift = Math.abs(resultRatio - compositeRatio) / compositeRatio;
    silhouetteRatioOk = drift <= silhouetteDriftMax;
  }

  return {
    compositeMeanRGB: [compMean.r, compMean.g, compMean.b],
    resultMeanRGB: [resultMean.r, resultMean.g, resultMean.b],
    colorDelta,
    compositeSilhouetteRatio: compositeRatio,
    resultSilhouetteRatio: resultRatio,
    silhouetteRatioOk,
    colorOk,
    passed: colorOk && silhouetteRatioOk,
  };
}
