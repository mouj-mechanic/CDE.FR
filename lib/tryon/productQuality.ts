"use client";

/**
 * Heuristic quality checks for product photos.
 *
 *  - alpha detection : edge-pixel alpha < 250 suggests a PNG cutout
 *  - subject size    : if opaque pixels cover less than ~5% of the canvas,
 *                       the product is "too small" inside its image
 *  - flat background : standard deviation of edge-pixel color < threshold
 *                       suggests a uniform background (white, gray, etc.)
 *
 *  These run client-side on an HTMLImageElement.
 */

import type { TryOnWarning } from "@/types";

export interface ProductQualityReport {
  hasTransparency: boolean;
  edgeAlphaCoverage: number;
  /** Ratio of opaque pixels over the whole image. */
  opaqueRatio: number;
  /** True if the background looks uniform (likely a studio photo). */
  uniformBackground: boolean;
  warnings: TryOnWarning[];
}

export async function checkProductQuality(
  img: HTMLImageElement
): Promise<ProductQualityReport> {
  const warnings: TryOnWarning[] = [];
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      hasTransparency: false,
      edgeAlphaCoverage: 0,
      opaqueRatio: 1,
      uniformBackground: false,
      warnings,
    };
  }
  ctx.drawImage(img, 0, 0, w, h);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return {
      hasTransparency: false,
      edgeAlphaCoverage: 0,
      opaqueRatio: 1,
      uniformBackground: false,
      warnings,
    };
  }

  const px = data.data;
  const border = Math.max(2, Math.floor(Math.min(w, h) * 0.02));

  let edgeAlphaBelow250 = 0;
  let edgeTotal = 0;
  let edgeColorSumR = 0;
  let edgeColorSumG = 0;
  let edgeColorSumB = 0;
  let edgeColorSumSq = 0;
  let opaqueCount = 0;

  const sampleEdge = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const a = px[i + 3];
    edgeTotal++;
    if (a < 250) edgeAlphaBelow250++;
    edgeColorSumR += px[i];
    edgeColorSumG += px[i + 1];
    edgeColorSumB += px[i + 2];
    edgeColorSumSq +=
      px[i] * px[i] + px[i + 1] * px[i + 1] + px[i + 2] * px[i + 2];
  };

  for (let x = 0; x < w; x += 4) {
    for (let y = 0; y < border; y++) sampleEdge(x, y);
    for (let y = h - border; y < h; y++) sampleEdge(x, y);
  }
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < border; x++) sampleEdge(x, y);
    for (let x = w - border; x < w; x++) sampleEdge(x, y);
  }

  // Full-image opaque count (every 4th pixel for speed).
  let opaqueSample = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      opaqueSample++;
      if (px[i + 3] > 250) opaqueCount++;
    }
  }
  const opaqueRatio = opaqueSample === 0 ? 1 : opaqueCount / opaqueSample;
  const edgeAlphaCoverage =
    edgeTotal === 0 ? 0 : edgeAlphaBelow250 / edgeTotal;
  const hasTransparency = edgeAlphaCoverage > 0.4;

  // Compute background uniformity (only meaningful if not transparent).
  let uniformBackground = false;
  if (edgeTotal > 0 && !hasTransparency) {
    const mean = (edgeColorSumR + edgeColorSumG + edgeColorSumB) / (3 * edgeTotal);
    const variance =
      edgeColorSumSq / (3 * edgeTotal) - mean * mean;
    uniformBackground = variance < 600; // empirical; very flat photos
  }

  if (!hasTransparency) {
    warnings.push({
      code: "product-has-background",
      message:
        "Image produit avec fond détecté. Utilisez une image produit isolée pour un meilleur rendu.",
    });
  }

  if (opaqueRatio < 0.06 && hasTransparency) {
    warnings.push({
      code: "product-too-small",
      message:
        "Produit trop petit dans l'image. Cadrez le produit plus près pour un meilleur rendu.",
    });
  }

  return {
    hasTransparency,
    edgeAlphaCoverage,
    opaqueRatio,
    uniformBackground,
    warnings,
  };
}
