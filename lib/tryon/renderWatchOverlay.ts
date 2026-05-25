"use client";

/**
 * Watch-specific deterministic overlay renderer (v2 — 3-part wrist-aware).
 *
 *  Pipeline:
 *    1. Refine the product alpha (tight crop, halo removal, mild erosion,
 *       1-px feather).
 *    2. Split the product into three overlapping zones:
 *          left strap | central dial | right strap
 *    3. Compute wrist geometry from MediaPipe hand landmarks.
 *    4. Apply manual user adjustments (offset / scale / rotation / curvature
 *       / shadow intensity).
 *    5. Per-segment warp:
 *          - dial   : no bend, slight tilt only
 *          - straps : parabolic bend down + horizontal compression toward
 *                     the outer ends, plus a vertical alpha fade so they
 *                     read as "going behind the wrist".
 *    6. Build a unified silhouette canvas → ambient + contact shadow.
 *    7. Composite back-to-front: ambient → contact → left strap → right
 *       strap → dial.
 *    8. Subtle skin-tone adaptation: sample a wrist patch, compute average
 *       luminance vs the watch, apply a capped ±brightness blend (no blur).
 *    9. Export as PNG so alpha is preserved end-to-end.
 *
 *  The renderer is deterministic — no AI calls. It is safe to re-run on
 *  every slider tick (~50–90 ms on a modern laptop).
 */

import { refineAlphaMask, type RefinedImage } from "./alphaRefine";
import { segmentWatch, type WatchSegments } from "./watchSegmentation";
import { warpSegment, fadeStrapOuterEnd, type WarpedSegment } from "./warp";
import { buildShadowLayers } from "./shadow";
import {
  computeWristGeometry,
  fallbackWristGeometry,
  type WristGeometry,
} from "./watchGeometry";
import { buildContactMask } from "./watchMask";
import type { TryOnLandmarks } from "./types";

export interface WatchAdjustments {
  /** Horizontal offset in pixels, applied after the auto wrist centre. */
  offsetX: number;
  /** Vertical offset in pixels, applied after the auto wrist centre. */
  offsetY: number;
  /** Scale multiplier on top of the auto-computed wrist width. */
  scale: number;
  /** Additional rotation in radians, applied on top of the wrist axis. */
  rotation: number;
  /** Curvature in [0..1]; default 0.45 (UI shows 45 on a 0..100 slider). */
  curvature: number;
  /** Shadow intensity in [0..1]; default 0.6 (UI shows 60). */
  shadowIntensity: number;
}

export const DEFAULT_WATCH_ADJUSTMENTS: WatchAdjustments = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  curvature: 0.45,
  shadowIntensity: 0.6,
};

export interface WatchRenderInput {
  userImage: HTMLImageElement;
  productImage: HTMLImageElement;
  landmarks: TryOnLandmarks | null;
  adjustments?: Partial<WatchAdjustments>;
}

export interface WatchRenderResult {
  blob: Blob;
  url: string;
  refined: RefinedImage;
  geometry: WristGeometry;
  fromLandmarks: boolean;
  edgeQuality: number;
  confidence: number;
  /**
   * PNG black + white contact-band mask, same dimensions as the composite.
   * White = "AI may repaint" (8–14 px ring around the watch silhouette).
   * Black = "AI must preserve" (dial center, skin, background).
   */
  maskBlob: Blob;
  maskUrl: string;
}

// ──────────────────────────────────────────────────────────────────────────
//  main entry
// ──────────────────────────────────────────────────────────────────────────

export async function renderWatchOverlay(
  input: WatchRenderInput
): Promise<WatchRenderResult> {
  const adj: WatchAdjustments = {
    ...DEFAULT_WATCH_ADJUSTMENTS,
    ...(input.adjustments ?? {}),
  };
  const userW = input.userImage.naturalWidth || input.userImage.width;
  const userH = input.userImage.naturalHeight || input.userImage.height;

  // 1. Refine product alpha + tight crop.
  const refined = await refineAlphaMask(input.productImage);
  const productAspect = refined.height / refined.width;

  // 2. Segmentation.
  const segments = segmentWatch(refined);

  // 3. Wrist geometry (auto + manual offsets).
  const auto = input.landmarks
    ? computeWristGeometry(input.landmarks, productAspect)
    : null;
  const base = auto ?? fallbackWristGeometry(userW, userH, productAspect);

  const geometry: WristGeometry = {
    ...base,
    cx: base.cx + adj.offsetX,
    cy: base.cy + adj.offsetY,
    width: base.width * adj.scale,
    height: base.height * adj.scale,
    rotation: base.rotation + adj.rotation,
  };

  // 4. Per-segment warping.
  //
  // Each segment occupies a fixed fraction of the original product. We
  // compute its target width by simple proportion. The dial gets curvature
  // ×0.15 (it should stay almost sharp); the straps get the full curvature.
  const dialTargetW = geometry.width * (segments.dial.fractionEnd - segments.dial.fractionStart);
  const leftTargetW = geometry.width * (segments.leftStrap.fractionEnd - segments.leftStrap.fractionStart);
  const rightTargetW = geometry.width * (segments.rightStrap.fractionEnd - segments.rightStrap.fractionStart);
  const targetH = geometry.height;

  const warpedDial = warpSegment(segments.dial, {
    width: dialTargetW,
    height: targetH,
    curvature: adj.curvature * 0.15,
    bendDirection: "center",
  });
  const warpedLeft = warpSegment(segments.leftStrap, {
    width: leftTargetW,
    height: targetH,
    curvature: adj.curvature,
    bendDirection: "left",
  });
  const warpedRight = warpSegment(segments.rightStrap, {
    width: rightTargetW,
    height: targetH,
    curvature: adj.curvature,
    bendDirection: "right",
  });

  // 5. Occlusion fade — outer strap ends melt into the wrist.
  if (adj.curvature > 0.05) {
    fadeStrapOuterEnd(warpedLeft.canvas, "left", adj.curvature);
    fadeStrapOuterEnd(warpedRight.canvas, "right", adj.curvature);
  }

  // 6. Per-segment centres in the rotated wrist frame.
  //    The product's geometric centre (in the original image) is at 0.5
  //    of its width. Each segment's centre maps to:
  //      cxFraction = (fractionStart + fractionEnd) / 2
  //    Offset from the product centre = (cxFraction - 0.5) * geometry.width
  const segmentCentreOffsets = {
    left:
      ((segments.leftStrap.fractionStart + segments.leftStrap.fractionEnd) /
        2 -
        0.5) *
      geometry.width,
    dial: 0,
    right:
      ((segments.rightStrap.fractionStart + segments.rightStrap.fractionEnd) /
        2 -
        0.5) *
      geometry.width,
  };

  // 7. Build a unified silhouette canvas (used only for shadows).
  const silhouette = compositeSegmentsToSilhouette(
    geometry.width,
    geometry.height,
    warpedLeft,
    warpedDial,
    warpedRight,
    segmentCentreOffsets
  );

  // 8. Shadow layers — opacity scales with shadowIntensity.
  const intensityMul = adj.shadowIntensity / 0.6;
  const shadows = buildShadowLayers(silhouette.canvas, {
    width: silhouette.canvas.width,
    height: silhouette.canvas.height,
    ambientBlur: 14,
    contactBlur: 4,
    ambientOpacity: Math.min(0.45, 0.18 * intensityMul),
    contactOpacity: Math.min(0.6, 0.28 * intensityMul),
    ambientOffsetY: Math.max(2, Math.round(silhouette.canvas.height * 0.02)),
  });

  // 9. Composite onto user photo.
  const out = document.createElement("canvas");
  out.width = userW;
  out.height = userH;
  const ctx = out.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable for watch overlay.");
  }
  ctx.drawImage(input.userImage, 0, 0, userW, userH);

  ctx.save();
  ctx.translate(geometry.cx, geometry.cy);
  ctx.rotate(geometry.rotation);

  // Shadows go first, centred on the silhouette canvas centre.
  const silDrawX = -silhouette.canvas.width / 2;
  const silDrawY = -silhouette.canvas.height / 2;
  ctx.drawImage(
    shadows.ambient,
    silDrawX,
    silDrawY,
    silhouette.canvas.width,
    silhouette.canvas.height
  );
  ctx.drawImage(
    shadows.contact,
    silDrawX,
    silDrawY,
    silhouette.canvas.width,
    silhouette.canvas.height
  );

  // Straps first, dial on top (covers any seam in the overlap region).
  drawWarpedAt(ctx, warpedLeft, segmentCentreOffsets.left);
  drawWarpedAt(ctx, warpedRight, segmentCentreOffsets.right);
  drawWarpedAt(ctx, warpedDial, segmentCentreOffsets.dial);

  ctx.restore();

  // 10. Subtle skin-tone adaptation. We sample a wrist patch *outside* the
  //     placed watch area, compute the luminance delta, and apply a capped
  //     source-atop tint to the entire watch region. Details stay sharp
  //     because we never blur.
  try {
    applySkinTone(ctx, input.userImage, geometry);
  } catch {
    // Non-fatal — skip skin integration if pixel access is blocked.
  }

  // 11. Build the contact-band mask using the same silhouette + geometry
  //     used for the composite. It must align pixel-for-pixel with `out`.
  const mask = await buildContactMask({
    width: userW,
    height: userH,
    centerX: geometry.cx,
    centerY: geometry.cy,
    rotation: geometry.rotation,
    silhouette: silhouette.canvas,
    // 20-px Gaussian feather → the white silhouette bleeds 18–24 px into
    // the black background (i.e. onto the wrist skin). This is the AO
    // blending zone where FLUX Fill paints realistic contact shadows.
    // Going below ~16 px makes the result look like a 2D sticker again;
    // above ~26 px the dial starts to lose contrast at the bezel edge.
    featherPx: 20,
    // Extra soft white patch under the watch (~22 % of watch height) so
    // the contact-shadow zone reaches further onto the forearm.
    groundedShadowPx: Math.round(geometry.height * 0.22),
  });

  // 12. Export composite PNG.
  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Watch overlay export failed.")),
      "image/png"
    );
  });
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    refined,
    geometry,
    fromLandmarks: Boolean(auto),
    edgeQuality: refined.edgeQuality,
    confidence: auto?.confidence ?? 0,
    maskBlob: mask.blob,
    maskUrl: mask.url,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  helpers
// ──────────────────────────────────────────────────────────────────────────

function drawWarpedAt(
  ctx: CanvasRenderingContext2D,
  warped: WarpedSegment,
  centerOffsetX: number
): void {
  const drawX = centerOffsetX - warped.width / 2;
  const drawY = -warped.height / 2;
  ctx.drawImage(warped.canvas, drawX, drawY, warped.width, warped.height);
}

interface Silhouette {
  canvas: HTMLCanvasElement;
}

function compositeSegmentsToSilhouette(
  geomWidth: number,
  geomHeight: number,
  left: WarpedSegment,
  dial: WarpedSegment,
  right: WarpedSegment,
  centres: { left: number; dial: number; right: number }
): Silhouette {
  // Bounding box that fits all 3 segments centred on their offsets.
  const lLeft = centres.left - left.width / 2;
  const lRight = centres.left + left.width / 2;
  const rLeft = centres.right - right.width / 2;
  const rRight = centres.right + right.width / 2;
  const dLeft = centres.dial - dial.width / 2;
  const dRight = centres.dial + dial.width / 2;

  const minX = Math.floor(Math.min(lLeft, dLeft, rLeft));
  const maxX = Math.ceil(Math.max(lRight, dRight, rRight));
  const W = Math.max(1, maxX - minX);
  const H = Math.max(1, Math.max(left.height, dial.height, right.height));

  // Add a small padding so blurred shadows have room.
  const pad = Math.ceil(Math.max(W, H) * 0.06);
  const cw = W + pad * 2;
  const ch = H + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas };
  ctx.clearRect(0, 0, cw, ch);
  // Map segment world-X (centred on 0) → silhouette X (centred on cw/2).
  const toSx = (x: number): number => x - minX + pad;

  ctx.drawImage(
    left.canvas,
    toSx(centres.left - left.width / 2),
    pad + (H - left.height) / 2,
    left.width,
    left.height
  );
  ctx.drawImage(
    right.canvas,
    toSx(centres.right - right.width / 2),
    pad + (H - right.height) / 2,
    right.width,
    right.height
  );
  ctx.drawImage(
    dial.canvas,
    toSx(centres.dial - dial.width / 2),
    pad + (H - dial.height) / 2,
    dial.width,
    dial.height
  );

  // The silhouette canvas is wider than `geomWidth` because of the bend
  // headroom and the padding. We don't crop here — the caller draws it
  // centred on (cx, cy) and the extra space hosts the soft shadow.
  void geomWidth;
  void geomHeight;

  return { canvas };
}

/**
 * Capped ±brightness adaptation on the watch silhouette.
 *
 *  - Samples a 64×64 patch of the wrist around the watch centre (slightly
 *    offset to avoid the watch itself).
 *  - Computes the average luminance ratio between wrist patch and the
 *    currently rendered watch region.
 *  - Applies a `source-atop` translucent fill — never blurs or distorts.
 *  - Magnitude capped to ±8% so identity is preserved.
 */
function applySkinTone(
  ctx: CanvasRenderingContext2D,
  userImage: HTMLImageElement,
  geometry: WristGeometry
): void {
  const sample = 48;
  // Sample a patch *adjacent* to the watch along the forearm direction so
  // we don't read the freshly-drawn watch pixels.
  const px = geometry.cx + geometry.forearm.x * geometry.palmWidth * 0.7;
  const py = geometry.cy + geometry.forearm.y * geometry.palmWidth * 0.7;
  const patchSize = geometry.palmWidth * 0.6;

  const patch = document.createElement("canvas");
  patch.width = sample;
  patch.height = sample;
  const pctx = patch.getContext("2d");
  if (!pctx) return;
  try {
    pctx.drawImage(
      userImage,
      px - patchSize / 2,
      py - patchSize / 2,
      patchSize,
      patchSize,
      0,
      0,
      sample,
      sample
    );
    const data = pctx.getImageData(0, 0, sample, sample).data;
    let sumL = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 16) continue;
      sumL += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      n++;
    }
    if (n === 0) return;
    const wristL = sumL / n / 255;

    // Sample the watch region from the destination canvas.
    const wctx = ctx;
    const watchSample = sample;
    const wPatch = document.createElement("canvas");
    wPatch.width = watchSample;
    wPatch.height = watchSample;
    const wpctx = wPatch.getContext("2d");
    if (!wpctx) return;
    wpctx.drawImage(
      ctx.canvas,
      geometry.cx - geometry.width / 2,
      geometry.cy - geometry.height / 2,
      geometry.width,
      geometry.height,
      0,
      0,
      watchSample,
      watchSample
    );
    const wdata = wpctx.getImageData(0, 0, watchSample, watchSample).data;
    let wSumL = 0;
    let wn = 0;
    for (let i = 0; i < wdata.length; i += 4) {
      const a = wdata[i + 3];
      if (a < 16) continue;
      wSumL +=
        wdata[i] * 0.299 + wdata[i + 1] * 0.587 + wdata[i + 2] * 0.114;
      wn++;
    }
    if (wn === 0) return;
    const watchL = wSumL / wn / 255;

    let delta = wristL - watchL;
    delta = Math.max(-0.08, Math.min(0.08, delta));
    if (Math.abs(delta) < 0.01) return;

    // Apply tint only inside the watch box, using source-atop so transparent
    // pixels outside the silhouette stay untouched. The watch box rotates
    // with the wrist axis.
    wctx.save();
    wctx.translate(geometry.cx, geometry.cy);
    wctx.rotate(geometry.rotation);
    wctx.globalCompositeOperation = "source-atop";
    // Slightly larger than the watch geometry to be safe against rotation
    // bounding errors.
    const tintW = geometry.width * 1.05;
    const tintH = geometry.height * 1.4;
    if (delta > 0) {
      wctx.fillStyle = `rgba(255,255,255, ${delta * 0.35})`;
    } else {
      wctx.fillStyle = `rgba(0,0,0, ${Math.abs(delta) * 0.35})`;
    }
    wctx.fillRect(-tintW / 2, -tintH / 2, tintW, tintH);
    wctx.restore();
  } catch {
    // CORS or context errors — bail silently. Skin tone is a nice-to-have.
  }
}
