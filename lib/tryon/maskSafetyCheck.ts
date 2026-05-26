import sharp from "sharp";
import type { CategoryId } from "@/types";
import { computeEditableEnergy } from "./maskValidation";

/**
 * Pre-flight safety checks on the auto-generated mask BEFORE it
 * reaches OpenAI.
 *
 *  These rules catch the classic "the mask blew up and covers the
 *  whole hand" failure mode that produces destroyed-finger results:
 *
 *    - **Inverted mask**: a bug where the editable / preserved
 *      conventions get swapped. Detected when editable energy goes
 *      past 50 % of the image.
 *    - **Hand-area takeover**: the auto-mask widened progressively
 *      until its bounding box covers most of the wrist / hand. For
 *      watches we hard-cap the editable bbox area at 18 % of the
 *      image.
 *    - **Border touching**: the editable area touches an image edge,
 *      which almost always means the mask spilled outside the wrist
 *      into the background.
 *    - **Outside the expected zone**: when the caller supplies a
 *      product bbox, we measure the editable energy that falls
 *      OUTSIDE the bbox + a 64 px ring. Anything past 4 % is
 *      considered an off-target mask.
 *
 *  All of these block the OpenAI call entirely. The route then falls
 *  back to the deterministic composite — never the customer's hand.
 */

export interface MaskSafetyInput {
  /** B/W PNG buffer (white = editable, black = preserved). */
  mask: Buffer;
  category: CategoryId;
  /**
   * Optional expected product bbox in NORMALISED coordinates (0..1).
   * When provided, the safety check verifies that the editable area
   * stays inside this bbox (plus a small margin).
   */
  productBBox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface MaskSafetyResult {
  ok: boolean;
  /**
   * Stable reason code. Empty when `ok=true`. Customers never see
   * these — they live in `debug.failureReasons` only.
   */
  reasons: string[];
  /** Stats exposed for diagnostics. */
  stats: {
    editableEnergyRatio: number;
    bbox: { x0: number; y0: number; x1: number; y1: number; ratio: number };
    touchesBorder: boolean;
    outsideBBoxRatio: number;
    inverted: boolean;
  };
}

const DEFAULT_BORDER_PX = 2;

/**
 * Compute the bbox of the bright (>= 40) pixels of a B/W mask. Returns
 * normalised coordinates + the fraction of total area the bbox covers.
 */
async function bbox(maskBuf: Buffer): Promise<{
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ratio: number;
  width: number;
  height: number;
  touchesBorder: boolean;
}> {
  const { data, info } = await sharp(maskBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const v = data[(y * info.width + x) * info.channels];
      if (v >= 40) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return {
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      ratio: 0,
      width: info.width,
      height: info.height,
      touchesBorder: false,
    };
  }
  const ratio = ((maxX - minX) * (maxY - minY)) / (info.width * info.height);
  const touchesBorder =
    minX <= DEFAULT_BORDER_PX ||
    minY <= DEFAULT_BORDER_PX ||
    maxX >= info.width - 1 - DEFAULT_BORDER_PX ||
    maxY >= info.height - 1 - DEFAULT_BORDER_PX;
  return {
    x0: minX / info.width,
    y0: minY / info.height,
    x1: maxX / info.width,
    y1: maxY / info.height,
    ratio,
    width: info.width,
    height: info.height,
    touchesBorder,
  };
}

/**
 * Sum the editable energy that falls OUTSIDE the supplied (expanded)
 * product bbox. Used to verify the mask actually sits where the
 * watch was placed.
 */
async function energyOutsideBBox(
  maskBuf: Buffer,
  bb: { x0: number; y0: number; x1: number; y1: number },
  padRatio: number
): Promise<number> {
  const { data, info } = await sharp(maskBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const px0 = Math.max(0, Math.floor((bb.x0 - padRatio) * W));
  const py0 = Math.max(0, Math.floor((bb.y0 - padRatio) * H));
  const px1 = Math.min(W, Math.ceil((bb.x1 + padRatio) * W));
  const py1 = Math.min(H, Math.ceil((bb.y1 + padRatio) * H));
  let outsideEnergy = 0;
  let totalEnergy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = data[(y * W + x) * info.channels];
      const e = v / 255;
      totalEnergy += e;
      if (x < px0 || x >= px1 || y < py0 || y >= py1) {
        outsideEnergy += e;
      }
    }
  }
  return totalEnergy > 0 ? outsideEnergy / totalEnergy : 0;
}

/**
 * Per-category bbox-area caps. The bbox of the editable pixels must
 * stay below this fraction of the image. Catches "mask covers the
 * whole hand" without needing landmarks — a 12 px ring around a
 * realistically-sized watch yields a bbox around 6–10 % of a
 * portrait photo, never above 14 %.
 */
const MAX_BBOX_RATIO: Record<CategoryId, number> = {
  watch: 0.14,
  "hand-jewelry": 0.16,
  glasses: 0.25,
  headwear: 0.35,
  clothes: 0.85,
};

const MAX_OUTSIDE_BBOX_RATIO: Record<CategoryId, number> = {
  watch: 0.04,
  "hand-jewelry": 0.05,
  glasses: 0.08,
  headwear: 0.1,
  clothes: 0.5,
};

const INVERSION_THRESHOLD = 0.5;

export async function checkWatchMaskSafety(
  input: MaskSafetyInput
): Promise<MaskSafetyResult> {
  const reasons: string[] = [];

  const energy = await computeEditableEnergy(input.mask);
  const inverted = energy.editableEnergyRatio > INVERSION_THRESHOLD;
  if (inverted) {
    reasons.push("mask_probably_inverted");
  }

  const bb = await bbox(input.mask);
  if (bb.ratio > MAX_BBOX_RATIO[input.category]) {
    reasons.push("mask_bbox_covers_too_much_hand");
  }
  if (bb.touchesBorder) {
    reasons.push("mask_touches_image_border");
  }

  let outsideBBoxRatio = 0;
  if (input.productBBox) {
    outsideBBoxRatio = await energyOutsideBBox(
      input.mask,
      input.productBBox,
      0.06
    );
    if (outsideBBoxRatio > MAX_OUTSIDE_BBOX_RATIO[input.category]) {
      reasons.push("mask_energy_outside_product_zone");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    stats: {
      editableEnergyRatio: energy.editableEnergyRatio,
      bbox: {
        x0: bb.x0,
        y0: bb.y0,
        x1: bb.x1,
        y1: bb.y1,
        ratio: bb.ratio,
      },
      touchesBorder: bb.touchesBorder,
      outsideBBoxRatio,
      inverted,
    },
  };
}
