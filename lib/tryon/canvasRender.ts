"use client";

/**
 * Deterministic compositing on `<canvas>`. No AI involved.
 *
 *  Pipeline:
 *   1. Draw the user photo at native resolution.
 *   2. Crop the product to its visible bounding box (using alpha if PNG
 *      transparent, otherwise the full image).
 *   3. Rotate + scale the product to the target `Placement`.
 *   4. Composite with a soft shadow drawn separately, so we never paint a
 *      rectangle behind the product.
 *
 *  Returns a PNG Blob (alpha-preserving) ready to be displayed and uploaded.
 */

import type { Placement } from "./types";

interface RenderOptions {
  userImage: HTMLImageElement;
  productImage: HTMLImageElement;
  placement: Placement;
  /** Whether to add a soft drop shadow. Default: true. */
  withShadow?: boolean;
}

/** Find the tightest alpha-aware bounding box of an image. */
async function tightCrop(
  img: HTMLImageElement
): Promise<{
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}> {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  if (!ctx) return { canvas: off, width: w, height: h };
  ctx.drawImage(img, 0, 0, w, h);

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    // CORS taint — fall back to full image.
    return { canvas: off, width: w, height: h };
  }

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  const data = pixels.data;
  const threshold = 8; // alpha threshold to consider opaque enough
  let opaqueCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        opaqueCount++;
      }
    }
  }

  // If almost everything is opaque (likely a JPEG without alpha), keep full.
  if (opaqueCount === 0 || opaqueCount > w * h * 0.9) {
    return { canvas: off, width: w, height: h };
  }

  const cw = Math.max(1, maxX - minX + 1);
  const ch = Math.max(1, maxY - minY + 1);
  const cropped = document.createElement("canvas");
  cropped.width = cw;
  cropped.height = ch;
  const cctx = cropped.getContext("2d");
  if (!cctx) return { canvas: off, width: w, height: h };
  cctx.drawImage(off, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: cropped, width: cw, height: ch };
}

export async function renderOverlay(opts: RenderOptions): Promise<Blob> {
  const { userImage, productImage, placement } = opts;
  const withShadow = opts.withShadow ?? true;

  const W = userImage.naturalWidth || userImage.width;
  const H = userImage.naturalHeight || userImage.height;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable.");
  }

  // The user photo is opaque; draw it first as the background.
  ctx.drawImage(userImage, 0, 0, W, H);

  const { canvas: prodCanvas, width: pw, height: ph } =
    await tightCrop(productImage);

  // Preserve product aspect ratio: fit *inside* the placement box.
  const aspect = pw / ph;
  let drawW = placement.width;
  let drawH = drawW / aspect;
  if (drawH > placement.height) {
    drawH = placement.height;
    drawW = drawH * aspect;
  }

  // Apply rotation + position around the centre.
  ctx.save();
  ctx.translate(placement.cx, placement.cy);
  ctx.rotate(placement.rotation);

  // Soft drop-shadow. We rely on canvas `shadow*` which uses the *alpha* of
  // the next drawImage — so we are NOT painting a rectangle behind the
  // product. If the product image lacks alpha (i.e. it has a background),
  // the shadow will still match its bounding box; we accept that and let
  // the product-quality warnings flag it.
  if (withShadow && (placement.shadow ?? 0) > 0) {
    ctx.shadowColor = `rgba(0,0,0,${Math.min(0.55, placement.shadow ?? 0.3)})`;
    ctx.shadowBlur = Math.max(8, Math.min(40, drawW * 0.08));
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = drawH * 0.08;
  }

  ctx.drawImage(prodCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    // PNG export — alpha-preserving. The compositing result remains opaque
    // because of the user-photo background layer, but exporting as PNG
    // guarantees no JPEG re-compression / colour shift of the product
    // edges (important for jewellery and watches with fine details).
    canvas.toBlob(
      (b) => {
        if (!b) reject(new Error("Canvas export failed."));
        else resolve(b);
      },
      "image/png"
    );
  });
}

/** Quick helper used by ResultView to display a debug placement frame. */
export function describePlacement(p: Placement | null): string {
  if (!p) return "none";
  return `${Math.round(p.width)}×${Math.round(p.height)}px @ (${Math.round(
    p.cx
  )}, ${Math.round(p.cy)}) ${((p.rotation * 180) / Math.PI).toFixed(1)}°`;
}
