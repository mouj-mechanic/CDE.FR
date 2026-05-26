import sharp from "sharp";

/**
 * Post-composition safety gate. After we've assembled the final
 * watch / hand-jewelry image (typically via composeLockedAccessoryFinal
 * or product-lock), we run TWO independent checks:
 *
 *   1. `checkHandArtifactDamage` — compares the final image to the
 *      original user photo OUTSIDE the allowed edit zone. Big diffs
 *      mean the AI / compositor leaked into fingers / nails /
 *      background → reject.
 *   2. `checkVisibleMaskArtifacts` — looks for thin pure-white or
 *      pure-black lines around the product silhouette, which is the
 *      signature of a mask outline being baked into the result.
 *
 *  Both run on a downsampled copy so they are cheap (≤ 30 ms each on
 *  a 256×256 buffer).
 */

const DOWNSAMPLE = 256;

interface RawAt {
  data: Buffer;
  info: { width: number; height: number; channels: number };
}

async function toRawAt(buf: Buffer, w: number, h: number): Promise<RawAt> {
  return await sharp(buf)
    .resize(w, h, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

export interface HandArtifactCheckInput {
  /** Original customer photo. */
  userBase: Buffer;
  /** Final (composed) image being shipped to the customer. */
  finalImage: Buffer;
  /**
   * Optional alpha mask (255 = preserved, 0 = editable). When
   * provided, the comparator excludes the editable area + a small
   * margin from the diff so legitimate contact-shadow blending
   * doesn't trip the gate.
   */
  allowedEditAlpha?: Buffer | null;
}

export interface HandArtifactCheckResult {
  /** Average colour drift on the preserved area. 0..1. */
  drift: number;
  /** True when drift is above the production threshold. */
  isDamaged: boolean;
  /** Reason code for debug. */
  reason?: string;
}

/**
 * `drift = Σ |Δrgb|/3 / 255 / N_preserved`. Anything above ~3 %
 * means meaningful pixels outside the edit zone changed — almost
 * always a hand / finger destruction artefact.
 */
export async function checkHandArtifactDamage(
  input: HandArtifactCheckInput
): Promise<HandArtifactCheckResult> {
  const [a, b, alpha] = await Promise.all([
    toRawAt(input.userBase, DOWNSAMPLE, DOWNSAMPLE),
    toRawAt(input.finalImage, DOWNSAMPLE, DOWNSAMPLE),
    input.allowedEditAlpha
      ? sharp(input.allowedEditAlpha)
          .resize(DOWNSAMPLE, DOWNSAMPLE, { fit: "fill" })
          .extractChannel("alpha")
          .raw()
          .toBuffer({ resolveWithObject: true })
      : Promise.resolve(null as null | RawAt),
  ]);

  let drift = 0;
  let preserved = 0;
  const ach = a.info.channels;
  const bch = b.info.channels;
  for (let i = 0; i < DOWNSAMPLE * DOWNSAMPLE; i++) {
    if (alpha && alpha.data[i] < 200) continue;
    // Skip pixels that were already near-black in BOTH images (likely
    // letterbox residue).
    const al = (a.data[i * ach] + a.data[i * ach + 1] + a.data[i * ach + 2]) / 3;
    const bl = (b.data[i * bch] + b.data[i * bch + 1] + b.data[i * bch + 2]) / 3;
    if (al < 12 && bl < 12) continue;

    preserved++;
    const dr = Math.abs(a.data[i * ach] - b.data[i * bch]);
    const dg = Math.abs(a.data[i * ach + 1] - b.data[i * bch + 1]);
    const db = Math.abs(a.data[i * ach + 2] - b.data[i * bch + 2]);
    drift += (dr + dg + db) / 3 / 255;
  }
  if (preserved === 0) {
    return { drift: 0, isDamaged: false };
  }
  const mean = drift / preserved;
  // Tightened threshold (2.5 %): we now consider any meaningful change
  // outside the edit zone as a customer-preservation failure. Empirical
  // measurements on the auto-mask + locked-compose pipeline show that
  // a healthy run sits below 1 % drift, so 2.5 % is a comfortable
  // ceiling that still catches real damage early.
  const thresholdRaw = process.env.WATCH_HAND_ARTIFACT_THRESHOLD?.trim();
  const threshold = thresholdRaw ? Number(thresholdRaw) : 0.025;
  const isDamaged =
    mean > (Number.isFinite(threshold) ? threshold : 0.025);
  return {
    drift: mean,
    isDamaged,
    reason: isDamaged ? "hand_artifacts_detected" : undefined,
  };
}

export interface VisibleMaskArtifactInput {
  finalImage: Buffer;
  userBase: Buffer;
}

export interface VisibleMaskArtifactResult {
  visible: boolean;
  /** Ratio of "outline pixels" found in the final image. */
  outlinePixelRatio: number;
  reason?: string;
}

/**
 * Detect mask-outline artefacts: long runs of near-pure-white (>= 245)
 * or near-pure-black (<= 10) pixels that DIDN'T exist in the user
 * photo. These come from the segmentation mask bleeding into the
 * final image when the alpha conversion went wrong, or when the AI
 * stamped a sharp transition along the editable boundary.
 *
 *  Heuristic: count pixels in the final image whose luminance is
 *  either ≤ 10 or ≥ 245 AND whose corresponding pixel in the user
 *  base was firmly mid-tone (30..220). Above 0.4 % of the image,
 *  we flag it.
 */
export async function checkVisibleMaskArtifacts(
  input: VisibleMaskArtifactInput
): Promise<VisibleMaskArtifactResult> {
  const [a, b] = await Promise.all([
    toRawAt(input.userBase, DOWNSAMPLE, DOWNSAMPLE),
    toRawAt(input.finalImage, DOWNSAMPLE, DOWNSAMPLE),
  ]);
  const ach = a.info.channels;
  const bch = b.info.channels;
  let outlinePixels = 0;
  for (let i = 0; i < DOWNSAMPLE * DOWNSAMPLE; i++) {
    const bl = (b.data[i * bch] + b.data[i * bch + 1] + b.data[i * bch + 2]) / 3;
    const al = (a.data[i * ach] + a.data[i * ach + 1] + a.data[i * ach + 2]) / 3;
    const finalIsExtreme = bl <= 10 || bl >= 245;
    const baseIsMidtone = al > 30 && al < 220;
    if (finalIsExtreme && baseIsMidtone) outlinePixels++;
  }
  const outlinePixelRatio = outlinePixels / (DOWNSAMPLE * DOWNSAMPLE);
  // Lowered to 0.25 % — even a single hand-perimeter outline is enough
  // to ruin a render. The user photo gradient gate keeps false
  // positives away.
  const thresholdRaw = process.env.WATCH_MASK_ARTIFACT_THRESHOLD?.trim();
  const threshold = thresholdRaw ? Number(thresholdRaw) : 0.0025;
  const visible =
    outlinePixelRatio > (Number.isFinite(threshold) ? threshold : 0.0025);
  return {
    visible,
    outlinePixelRatio,
    reason: visible ? "visible_mask_artifacts" : undefined,
  };
}
