"use client";

/**
 * Watch product segmentation.
 *
 *  Splits the alpha-refined product image into three overlapping canvases:
 *
 *     ┌──────────────┬──────────────┬──────────────┐
 *     │  left strap  │ ← overlap → │  central     │ ← overlap → │  right strap │
 *     │   (0 .. 38%) │              │  dial        │              │  (62 .. 100%) │
 *     │              │              │  (32 .. 68%) │              │              │
 *     └──────────────┴──────────────┴──────────────┘
 *
 *  The dial's left/right edges are alpha-feathered so that, when the
 *  renderer composites the three pieces back at their proportional
 *  positions, the boundaries between dial and strap are seamless even if
 *  the per-segment warps don't pixel-align.
 *
 *  Straps are NOT feathered at their inner edges — they sit underneath the
 *  dial and only become visible past the dial's edge. Strap *outer* ends
 *  are faded later by the renderer, not here (it's an aesthetic effect that
 *  depends on the warp angle, so we apply it after warping).
 */

import type { RefinedImage } from "./alphaRefine";

export interface WatchSegment {
  /** Canvas holding only this segment's pixels (alpha-correct). */
  canvas: HTMLCanvasElement;
  /** Width of the un-warped segment in source pixels. */
  width: number;
  /** Height (always equal to refined.height). */
  height: number;
  /** Fraction of the original product width this segment starts at. */
  fractionStart: number;
  /** Fraction of the original product width this segment ends at. */
  fractionEnd: number;
}

export interface WatchSegments {
  leftStrap: WatchSegment;
  dial: WatchSegment;
  rightStrap: WatchSegment;
  /** Original (alpha-refined) product width in pixels. */
  productWidth: number;
  /** Original (alpha-refined) product height in pixels. */
  productHeight: number;
}

const ZONES = [
  { kind: "leftStrap" as const, start: 0.0, end: 0.38 },
  { kind: "dial" as const, start: 0.32, end: 0.68 },
  { kind: "rightStrap" as const, start: 0.62, end: 1.0 },
];

export function segmentWatch(refined: RefinedImage): WatchSegments {
  const W = refined.width;
  const H = refined.height;

  const built = ZONES.map((z) =>
    buildSegment(refined.canvas, W, H, z.start, z.end, z.kind)
  );

  return {
    leftStrap: built[0],
    dial: built[1],
    rightStrap: built[2],
    productWidth: W,
    productHeight: H,
  };
}

function buildSegment(
  source: HTMLCanvasElement,
  W: number,
  H: number,
  start: number,
  end: number,
  kind: "leftStrap" | "dial" | "rightStrap"
): WatchSegment {
  const x0 = Math.max(0, Math.floor(start * W));
  const x1 = Math.min(W, Math.ceil(end * W));
  const segW = Math.max(1, x1 - x0);

  const canvas = document.createElement("canvas");
  canvas.width = segW;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      canvas,
      width: segW,
      height: H,
      fractionStart: start,
      fractionEnd: end,
    };
  }
  ctx.clearRect(0, 0, segW, H);
  ctx.drawImage(source, x0, 0, segW, H, 0, 0, segW, H);

  // Only feather the dial sides — straps stay opaque on their inner side
  // because they sit *under* the dial in the final composite.
  if (kind === "dial") {
    const featherPx = Math.max(6, Math.round(W * 0.015));
    featherEdges(ctx, segW, H, featherPx, { left: true, right: true });
  }

  return {
    canvas,
    width: segW,
    height: H,
    fractionStart: start,
    fractionEnd: end,
  };
}

function featherEdges(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  feather: number,
  edges: { left: boolean; right: boolean }
): void {
  if (!edges.left && !edges.right) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  const f = Math.min(0.49, feather / w);
  if (edges.left && edges.right) {
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(f, "rgba(0,0,0,1)");
    grad.addColorStop(1 - f, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
  } else if (edges.left) {
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(f, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
  } else {
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(1 - f, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
