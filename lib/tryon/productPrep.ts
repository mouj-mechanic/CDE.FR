"use client";

/**
 * Basic product-image preprocessing.
 *
 * For an MVP we do *not* run an automatic background-removal model in
 * the browser (would add ~10 MB of WASM + 1-2 s of compute). Instead we:
 *  - detect whether the product image already has a transparent background
 *    (alpha < 250 on edges → likely PNG cutout)
 *  - hint the merchant if not, so they can supply a transparent PNG
 *
 *  This module also re-exposes a `loadImage()` helper that supports both
 *  HTML Image and ImageBitmap inputs.
 */

export interface ProductAnalysis {
  hasTransparency: boolean;
  width: number;
  height: number;
  /** % of edge pixels with alpha < 250. Useful to detect PNG cutouts. */
  edgeAlphaCoverage: number;
}

export async function loadImageFromBlob(
  blob: Blob
): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.crossOrigin = "anonymous";
    img.src = url;
  });
}

export async function analyzeProduct(
  img: HTMLImageElement
): Promise<ProductAnalysis> {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  if (!ctx) {
    return { hasTransparency: false, width: w, height: h, edgeAlphaCoverage: 0 };
  }
  ctx.drawImage(img, 0, 0, w, h);
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return { hasTransparency: false, width: w, height: h, edgeAlphaCoverage: 0 };
  }
  const data = imageData.data;
  const border = Math.max(2, Math.floor(Math.min(w, h) * 0.02));
  let transparentEdge = 0;
  let totalEdge = 0;
  const sample = (x: number, y: number) => {
    const a = data[(y * w + x) * 4 + 3];
    totalEdge++;
    if (a < 250) transparentEdge++;
  };
  for (let x = 0; x < w; x += 4) {
    for (let y = 0; y < border; y++) sample(x, y);
    for (let y = h - border; y < h; y++) sample(x, y);
  }
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < border; x++) sample(x, y);
    for (let x = w - border; x < w; x++) sample(x, y);
  }
  const coverage = totalEdge === 0 ? 0 : transparentEdge / totalEdge;
  return {
    hasTransparency: coverage > 0.4,
    edgeAlphaCoverage: coverage,
    width: w,
    height: h,
  };
}
