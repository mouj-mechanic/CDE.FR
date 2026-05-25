/**
 * Rectangular mask computation. For premium AI refinement we restrict the
 * model to a tight zone around the placed product so it cannot touch the
 * face, the body, or the background.
 */

import type { Placement, RefinementMask } from "./types";

/**
 * Compute an oriented bounding-box mask around a placed product, padded by
 * `paddingRatio` of the placement width to give the model a little context.
 */
export function maskFromPlacement(
  placement: Placement,
  paddingRatio = 0.15
): RefinementMask {
  const pad = placement.width * paddingRatio;
  return {
    x: placement.cx - placement.width / 2 - pad,
    y: placement.cy - placement.height / 2 - pad,
    width: placement.width + pad * 2,
    height: placement.height + pad * 2,
    rotation: placement.rotation,
  };
}

/**
 * Render an alpha mask PNG (white = editable, black = preserved) for the
 * given image dimensions. Suitable for providers that accept a `mask_image`
 * URL (e.g. some FLUX inpainting variants).
 */
export async function renderMaskPng(
  mask: RefinementMask,
  imageWidth: number,
  imageHeight: number
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("renderMaskPng() is browser-only.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable.");

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, imageWidth, imageHeight);

  ctx.save();
  ctx.translate(mask.x + mask.width / 2, mask.y + mask.height / 2);
  ctx.rotate(mask.rotation);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-mask.width / 2, -mask.height / 2, mask.width, mask.height);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Mask export failed."))),
      "image/png"
    );
  });
}
