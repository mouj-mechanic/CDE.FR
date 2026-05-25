"use client";

/**
 * Slice-based cylindrical warp.
 *
 *  Splits the (already alpha-refined and tight-cropped) product image into
 *  three zones:
 *
 *    [ left strap ]  [ central dial ]  [ right strap ]
 *
 *  The dial is left untouched (sharp watch face). The strap zones are
 *  compressed horizontally and bent downward so the bracelet visually
 *  wraps around the wrist instead of looking like a flat sticker.
 *
 *  The output is an offscreen canvas with the warped product. The canvas
 *  is sized to fit the warped silhouette + a small margin so the caller
 *  can place it at (cx, cy) without clipping.
 *
 *  ┌─────────────────────────────────────┐
 *  │  source  | dial |  source            │  (no warp on dial)
 *  │     \____|     |____/                │
 *  │    bent  |     |  bent               │  (warp on straps)
 *  └─────────────────────────────────────┘
 */

import type { RefinedImage } from "./alphaRefine";
import type { WatchSegment } from "./watchSegmentation";

/** Direction the segment bends:
 *  - "left"   → outer end at u=0 (left strap, bends down-left)
 *  - "right"  → outer end at u=1 (right strap, bends down-right)
 *  - "center" → no bend (dial)
 */
export type BendDirection = "left" | "right" | "center";

export interface SegmentWarpOptions {
  /** Final width (px) of the warped segment's un-bent face. */
  width: number;
  /** Final height (px) of the warped segment. */
  height: number;
  /** Curvature in [0..1]. Default 0.45. */
  curvature: number;
  bendDirection: BendDirection;
  /** Number of vertical slices (default 24). */
  slices?: number;
}

export interface WarpedSegment {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /**
   * Horizontal shift between the segment's un-bent centre and the actual
   * geometric centre of the warped silhouette. Useful when laying out the
   * three segments without visible drift.
   */
  centerShiftX: number;
}

/**
 * Warp a single watch segment (strap or dial) onto its target box.
 *
 *  The dial uses `bendDirection: "center"` and is rendered with no bend.
 *  Straps use `"left"` / `"right"`: the outer end is parabolically pushed
 *  downward and horizontally compressed to suggest wrist wrap-around.
 *
 *  The output canvas is taller than `opts.height` to give the bend
 *  headroom. The caller centres it at the segment's target position.
 */
export function warpSegment(
  segment: WatchSegment,
  opts: SegmentWarpOptions
): WarpedSegment {
  const slices = opts.slices ?? 24;
  const curvature = Math.max(0, Math.min(1, opts.curvature));
  const targetW = Math.max(1, opts.width);
  const targetH = Math.max(1, opts.height);

  // Bend headroom only on the side that actually bends; for simplicity we
  // give an equal margin top+bottom so rotation around the centre stays
  // symmetric.
  const bendMax = opts.bendDirection === "center" ? 0 : targetH * 0.22 * curvature;
  const outW = Math.ceil(targetW + 1);
  const outH = Math.ceil(targetH + bendMax * 2);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { canvas, width: outW, height: outH, centerShiftX: 0 };
  }
  ctx.clearRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const sw = segment.canvas.width;
  const sh = segment.canvas.height;

  // Per-slice horizontal compression + vertical bend factors.
  const compress: number[] = [];
  const bend: number[] = [];
  for (let i = 0; i < slices; i++) {
    const uMid = (i + 0.5) / slices;
    let t: number;
    switch (opts.bendDirection) {
      case "left":
        // outer end at u=0; bend increases towards 0
        t = (1 - uMid) ** 2;
        break;
      case "right":
        // outer end at u=1
        t = uMid ** 2;
        break;
      default:
        t = 0;
    }
    compress.push(1 - 0.35 * curvature * t);
    bend.push(bendMax * t);
  }
  const compressSum = compress.reduce((a, b) => a + b, 0);
  const targetSliceW = targetW / Math.max(1e-6, compressSum);

  let cursorX = 0;
  for (let i = 0; i < slices; i++) {
    const u0 = i / slices;
    const u1 = (i + 1) / slices;
    const sx = Math.floor(u0 * sw);
    const sliceSW = Math.max(1, Math.ceil((u1 - u0) * sw) + 1);
    const tw = compress[i] * targetSliceW;
    const yOff = bendMax + bend[i];

    // Slight tilt on side slices to reinforce the cylindrical illusion.
    let skewY = 0;
    if (opts.bendDirection === "left") {
      skewY = -curvature * 0.18 * (1 - (i + 0.5) / slices);
    } else if (opts.bendDirection === "right") {
      skewY = curvature * 0.18 * ((i + 0.5) / slices);
    }

    ctx.save();
    ctx.transform(1, skewY, 0, 1, cursorX, yOff);
    ctx.drawImage(segment.canvas, sx, 0, sliceSW, sh, 0, 0, tw + 0.5, targetH);
    ctx.restore();

    cursorX += tw;
  }

  return {
    canvas,
    width: outW,
    height: outH,
    centerShiftX: 0,
  };
}

/**
 * Apply a horizontal alpha fade-out to a strap's outer end to suggest the
 * bracelet disappearing behind the wrist (occlusion illusion).
 *
 *  Mutates the canvas in place.
 */
export function fadeStrapOuterEnd(
  canvas: HTMLCanvasElement,
  side: "left" | "right",
  curvature: number
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  // Fade more aggressively at higher curvatures (the wrist is "more
  // visible" to the side so the strap dives behind it faster).
  const fadeFraction = 0.15 + curvature * 0.18;
  const fadeOpacity = Math.max(0.25, 0.65 - curvature * 0.3);

  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  if (side === "left") {
    grad.addColorStop(0, `rgba(0,0,0,${fadeOpacity})`);
    grad.addColorStop(fadeFraction, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
  } else {
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(1 - fadeFraction, "rgba(0,0,0,1)");
    grad.addColorStop(1, `rgba(0,0,0,${fadeOpacity})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export interface WarpOptions {
  /** Final width of the warped product (pixels). */
  width: number;
  /** Final height of the warped product (pixels). */
  height: number;
  /**
   * Curvature in [0..1] :
   *   0   → flat overlay (no warp)
   *   1   → strong wrap-around (max horizontal compression + downward bend)
   *  Recommended default: 0.4
   */
  curvature: number;
  /** Fraction of the width occupied by the dial zone (default 0.42). */
  dialFraction?: number;
  /** Number of slices used to approximate the warp (default 48). */
  slices?: number;
}

export interface WarpedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Build a cylindrically warped copy of the product image.
 *
 *  The returned canvas is `out.width × out.height` with the warped product
 *  centred. The caller draws it at (cx − w/2, cy − h/2) after applying
 *  rotation.
 */
export function buildCylindricalWatch(
  product: RefinedImage,
  opts: WarpOptions
): WarpedImage {
  const slices = opts.slices ?? 48;
  const dialFraction = Math.max(0.2, Math.min(0.7, opts.dialFraction ?? 0.42));
  const curvature = Math.max(0, Math.min(1, opts.curvature));

  const targetW = opts.width;
  const targetH = opts.height;

  // Extra vertical headroom for the downward bend on the strap ends.
  const bendMax = targetH * 0.18 * curvature;
  const outW = Math.ceil(targetW);
  const outH = Math.ceil(targetH + bendMax * 2);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { canvas, width: outW, height: outH };
  }
  ctx.clearRect(0, 0, outW, outH);
  // High-quality sampling on resampled strips.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const src = product.canvas;
  const sw = src.width;
  const sh = src.height;

  // Compute per-slice horizontal compression and vertical bend.
  // Source goes from u=0..1 (left to right). The dial occupies the
  // centred [0.5 − d/2, 0.5 + d/2] range.
  const dialHalf = dialFraction / 2;
  const strapMax = 0.5 - dialHalf;

  // ── 1. Cumulative width pass to keep the total target width == outW.
  const sliceCompress: number[] = [];
  for (let i = 0; i < slices; i++) {
    const uMid = (i + 0.5) / slices;
    const distFromCenter = Math.abs(uMid - 0.5); // 0..0.5
    let c: number;
    if (distFromCenter <= dialHalf) {
      // Dial zone: no horizontal compression.
      c = 1;
    } else {
      // Strap zone: increasing compression near the ends.
      const t = (distFromCenter - dialHalf) / strapMax; // 0..1
      c = 1 - 0.4 * curvature * t * t;
    }
    sliceCompress.push(c);
  }
  const compressSum = sliceCompress.reduce((a, b) => a + b, 0);
  const targetSliceW = targetW / compressSum;

  // ── 2. Vertical bend function: 0 on dial, parabolic on straps.
  const bendAt = (u: number): number => {
    const distFromCenter = Math.abs(u - 0.5);
    if (distFromCenter <= dialHalf) return 0;
    const t = (distFromCenter - dialHalf) / strapMax;
    return bendMax * t * t;
  };

  // ── 3. Draw each slice. The origin of the warped canvas is (0,0) at the
  //       top-left of the *full* `outW × outH` canvas. The non-warped dial
  //       sits centred vertically with `bendMax` headroom above and below.
  let cursorX = 0;
  for (let i = 0; i < slices; i++) {
    const u0 = i / slices;
    const u1 = (i + 1) / slices;
    const uMid = (u0 + u1) / 2;
    const sx = Math.floor(u0 * sw);
    const sliceSW = Math.max(1, Math.ceil((u1 - u0) * sw) + 1);
    const tw = sliceCompress[i] * targetSliceW;
    const yOff = bendMax + bendAt(uMid);

    // Slight tilt: side strips also tilt inward to reinforce the cylindrical
    // illusion. We do this by feeding `setTransform` a small skew Y.
    const skewY =
      uMid < 0.5
        ? -curvature * 0.12 * (0.5 - uMid) // left strap tilts down-right
        : curvature * 0.12 * (uMid - 0.5); // right strap tilts down-left

    ctx.save();
    ctx.transform(1, skewY, 0, 1, cursorX, yOff);
    // Add a half-pixel overdraw to avoid hairline seams between strips.
    ctx.drawImage(src, sx, 0, sliceSW, sh, 0, 0, tw + 0.5, targetH);
    ctx.restore();

    cursorX += tw;
  }

  return { canvas, width: outW, height: outH };
}
