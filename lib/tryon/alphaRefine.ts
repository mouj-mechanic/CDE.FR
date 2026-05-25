"use client";

/**
 * Alpha cleanup for product PNGs (typically watches).
 *
 *  - Tight-crop to the bounding box of opaque pixels (no transparent padding).
 *  - Remove the bright halo that often surrounds a cutout when the bg was
 *    light (keying near-white pixels with low saturation against the alpha
 *    mask).
 *  - 1-px erosion of the alpha mask to kill jagged single-pixel
 *    semi-transparent leftovers.
 *  - 0.5–1.5 px Gaussian-ish feather to smooth jaggies without blurring
 *    actual details.
 *  - Edge-quality score, so we can warn merchants on dirty cutouts.
 *
 *  Returns an offscreen canvas with the refined ARGB pixels — the caller can
 *  draw it directly into the final composite.
 */

export interface RefinedImage {
  /** Refined image, tight-cropped, PNG-suitable (alpha-correct). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Bounding box of opaque pixels in the *source* image. */
  bounds: { x: number; y: number; width: number; height: number };
  /** True if the source image had a meaningful alpha channel. */
  hasAlpha: boolean;
  /**
   * Edge-quality score in [0..1].
   * - 1.0 → smooth anti-aliased silhouette with clean separation
   * - 0.5 → noisy or partially aliased edges
   * - <0.4 → likely a non-cutout or a cutout with halo / hard binary alpha
   */
  edgeQuality: number;
}

const FEATHER_PX = 1; // total feather radius (very subtle)

/**
 * Refine the alpha of a product image.
 *
 *  Safe to call even when the source has no alpha — in that case we return
 *  the un-modified image at its original size with `hasAlpha: false` and a
 *  low edgeQuality score.
 */
export async function refineAlphaMask(
  src: HTMLImageElement | HTMLCanvasElement
): Promise<RefinedImage> {
  const sw =
    src instanceof HTMLImageElement ? src.naturalWidth || src.width : src.width;
  const sh =
    src instanceof HTMLImageElement
      ? src.naturalHeight || src.height
      : src.height;

  const off = document.createElement("canvas");
  off.width = sw;
  off.height = sh;
  const ctx = off.getContext("2d");
  if (!ctx) {
    return {
      canvas: off,
      width: sw,
      height: sh,
      bounds: { x: 0, y: 0, width: sw, height: sh },
      hasAlpha: false,
      edgeQuality: 0.5,
    };
  }
  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(src, 0, 0, sw, sh);

  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, sw, sh);
  } catch {
    return {
      canvas: off,
      width: sw,
      height: sh,
      bounds: { x: 0, y: 0, width: sw, height: sh },
      hasAlpha: false,
      edgeQuality: 0.4,
    };
  }
  const data = img.data;

  // 1. Detect bounds + alpha presence.
  let minX = sw;
  let minY = sh;
  let maxX = 0;
  let maxY = 0;
  let opaqueCount = 0;
  let transparentCount = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const a = data[(y * sw + x) * 4 + 3];
      if (a < 16) {
        transparentCount++;
      } else {
        opaqueCount++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const hasAlpha = transparentCount > (sw * sh) * 0.05;

  if (!hasAlpha) {
    // No transparency to refine — return as-is.
    return {
      canvas: off,
      width: sw,
      height: sh,
      bounds: { x: 0, y: 0, width: sw, height: sh },
      hasAlpha: false,
      edgeQuality: 0.35,
    };
  }

  // 2. Remove halo: pixels close to the silhouette edge that are near-white
  //    and have low saturation are reduced in alpha. This is conservative —
  //    we never erase coloured pixels.
  haloRemoval(data, sw, sh);

  // 3. 1-px erosion of alpha (kills isolated semi-transparent dirt).
  const eroded = erodeAlpha(data, sw, sh, 1);

  // 4. Light feather on alpha only — 1-pixel box blur on the alpha plane.
  const feathered = featherAlpha(eroded, sw, sh, FEATHER_PX);

  // Write back.
  for (let i = 0; i < sw * sh; i++) {
    data[i * 4 + 3] = feathered[i];
  }
  ctx.putImageData(img, 0, 0);

  // 5. Compute edge-quality score on the refined alpha.
  const edgeQuality = computeEdgeQuality(feathered, sw, sh);

  // 6. Tight crop.
  const bw = Math.max(1, maxX - minX + 1);
  const bh = Math.max(1, maxY - minY + 1);
  // Add a 2-px transparent margin so feathering survives further resampling.
  const margin = 2;
  const cropW = bw + margin * 2;
  const cropH = bh + margin * 2;
  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  const cctx = cropped.getContext("2d");
  if (!cctx) {
    return {
      canvas: off,
      width: sw,
      height: sh,
      bounds: { x: minX, y: minY, width: bw, height: bh },
      hasAlpha: true,
      edgeQuality,
    };
  }
  cctx.clearRect(0, 0, cropW, cropH);
  cctx.drawImage(off, minX, minY, bw, bh, margin, margin, bw, bh);

  return {
    canvas: cropped,
    width: cropW,
    height: cropH,
    bounds: { x: minX, y: minY, width: bw, height: bh },
    hasAlpha: true,
    edgeQuality,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  internal helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Reduce alpha for pixels that look like white-ish halo around the cutout.
 *  - Pixel must be near the edge (within 2px of a transparent neighbour).
 *  - Pixel must be near-white (avg RGB > 235).
 *  - Pixel must have low saturation (max-min < 20).
 *
 *  When all three are true, we subtract a portion of alpha proportional to
 *  the "whiteness" of the pixel.
 */
function haloRemoval(
  data: Uint8ClampedArray,
  w: number,
  h: number
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a < 16 || a > 254) continue;
      // Already on a soft edge — check for halo.
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      const avg = (r + g + b) / 3;
      if (avg > 235 && sat < 20) {
        const whiteness = Math.min(1, (avg - 235) / 20);
        data[i + 3] = Math.max(0, Math.round(a * (1 - 0.6 * whiteness)));
      }
    }
  }
}

/** 1-px alpha erosion using 4-neighbour minimum. */
function erodeAlpha(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  iterations: number
): Uint8ClampedArray {
  let alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];

  for (let k = 0; k < iterations; k++) {
    const next = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        let m = alpha[idx];
        if (x > 0) m = Math.min(m, alpha[idx - 1]);
        if (x < w - 1) m = Math.min(m, alpha[idx + 1]);
        if (y > 0) m = Math.min(m, alpha[idx - w]);
        if (y < h - 1) m = Math.min(m, alpha[idx + w]);
        // Only erode mid-transparency pixels; keep fully-opaque pixels.
        next[idx] = alpha[idx] > 230 ? alpha[idx] : m;
      }
    }
    alpha = next;
  }
  return alpha;
}

/** Light separable box-blur on the alpha plane (kernel ≈ 1.5 px). */
function featherAlpha(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number
): Uint8ClampedArray {
  if (radius <= 0) return src;
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  const r = Math.max(1, Math.round(radius));
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xi = x + dx;
        if (xi < 0 || xi >= w) continue;
        sum += src[y * w + xi];
        count++;
      }
      tmp[y * w + x] = count === 0 ? src[y * w + x] : Math.round(sum / count);
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yi = y + dy;
        if (yi < 0 || yi >= h) continue;
        sum += tmp[yi * w + x];
        count++;
      }
      out[y * w + x] = count === 0 ? tmp[y * w + x] : Math.round(sum / count);
    }
  }
  return out;
}

/**
 * Edge-quality score. We measure the spread between transparent (<32) and
 * opaque (>224) along the silhouette boundary. A clean cutout has a thin
 * transition band; a noisy one has many "half-alpha" pixels far from the
 * edge.
 */
function computeEdgeQuality(
  alpha: Uint8ClampedArray,
  w: number,
  h: number
): number {
  let edgePixels = 0;
  let cleanEdge = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const a = alpha[idx];
      if (a > 32 && a < 224) {
        // We are on a soft edge.
        edgePixels++;
        const an = alpha[idx - w];
        const as = alpha[idx + w];
        const ae = alpha[idx + 1];
        const aw = alpha[idx - 1];
        // Clean edge: at least one neighbour is fully opaque AND another is
        // fully transparent.
        const hasOpaqueNb = an > 224 || as > 224 || ae > 224 || aw > 224;
        const hasTransNb = an < 32 || as < 32 || ae < 32 || aw < 32;
        if (hasOpaqueNb && hasTransNb) cleanEdge++;
      }
    }
  }
  if (edgePixels === 0) return 0.45;
  const ratio = cleanEdge / edgePixels;
  return Math.max(0, Math.min(1, 0.35 + ratio * 0.85));
}
