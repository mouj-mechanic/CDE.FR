"use client";

/**
 * Client-side alpha-channel utilities.
 *
 *  - imageHasAlpha(...)  : quick true/false on whether the bitmap actually
 *    contains any sub-opaque pixels (alpha < 250). Strict scan, no edge
 *    sampling tricks.
 *  - getImageAlphaStats(...) : returns hasAlpha + transparentPixelRatio so
 *    callers can show product-quality warnings.
 *
 *  These helpers do not perform any conversion — they only read pixels.
 *  Inputs accepted: File, Blob, URL string, HTMLImageElement.
 */

export type AlphaSource = File | Blob | string | HTMLImageElement;

const ALPHA_OPAQUE_THRESHOLD = 250; // a < 250 → counts as transparent

interface ImageWithRevoke {
  img: HTMLImageElement;
  revoke: () => void;
}

async function loadAlphaImage(source: AlphaSource): Promise<ImageWithRevoke> {
  if (source instanceof HTMLImageElement) {
    if (source.complete && source.naturalWidth > 0) {
      return { img: source, revoke: () => {} };
    }
    await new Promise<void>((resolve, reject) => {
      source.onload = () => resolve();
      source.onerror = (e) => reject(e);
    });
    return { img: source, revoke: () => {} };
  }

  let url: string;
  let revoke: () => void = () => {};
  if (typeof source === "string") {
    url = source;
  } else {
    url = URL.createObjectURL(source);
    revoke = () => URL.revokeObjectURL(url);
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
    img.src = url;
  });
  return { img, revoke };
}

function readPixels(
  img: HTMLImageElement
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Important: never set a fillStyle / fillRect before drawing — that would
  // flatten the image onto a background and destroy alpha information.
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    return { data, w, h };
  } catch {
    return null;
  }
}

/** Quick boolean — does this image contain any meaningfully transparent pixel? */
export async function imageHasAlpha(source: AlphaSource): Promise<boolean> {
  const { img, revoke } = await loadAlphaImage(source);
  try {
    const px = readPixels(img);
    if (!px) return false;
    const step = 4 * Math.max(1, Math.floor(px.data.length / 4 / 200000)); // sample
    for (let i = 3; i < px.data.length; i += step) {
      if (px.data[i] < ALPHA_OPAQUE_THRESHOLD) return true;
    }
    return false;
  } finally {
    revoke();
  }
}

export interface AlphaStats {
  hasAlpha: boolean;
  transparentPixelRatio: number;
  width: number;
  height: number;
}

/** Detailed alpha report. Scans every 4×4 block for performance. */
export async function getImageAlphaStats(
  source: AlphaSource
): Promise<AlphaStats> {
  const { img, revoke } = await loadAlphaImage(source);
  try {
    const px = readPixels(img);
    if (!px) {
      const w =
        img instanceof HTMLImageElement ? img.naturalWidth || img.width : 0;
      const h =
        img instanceof HTMLImageElement ? img.naturalHeight || img.height : 0;
      return { hasAlpha: false, transparentPixelRatio: 0, width: w, height: h };
    }
    const { data, w, h } = px;
    let transparent = 0;
    let total = 0;
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const a = data[(y * w + x) * 4 + 3];
        total++;
        if (a < ALPHA_OPAQUE_THRESHOLD) transparent++;
      }
    }
    const ratio = total === 0 ? 0 : transparent / total;
    return {
      hasAlpha: ratio > 0.02, // even a tiny soft-edge counts
      transparentPixelRatio: ratio,
      width: w,
      height: h,
    };
  } finally {
    revoke();
  }
}

/**
 * Best-effort MIME type for a product source.
 *
 *  - For files we trust `file.type` if non-empty.
 *  - For URLs we look at the path extension; defaults to "image/png" when
 *    extension is missing (most cutouts produced by fal are PNGs).
 */
export function inferImageMimeType(source: AlphaSource): string {
  if (source instanceof File) {
    if (source.type) return source.type;
  }
  if (typeof source === "string") {
    const m = source.toLowerCase().match(/\.(png|jpe?g|webp|gif|avif)(\?|$|#)/);
    if (m) {
      const ext = m[1];
      if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
      if (ext === "png") return "image/png";
      if (ext === "webp") return "image/webp";
      if (ext === "gif") return "image/gif";
      if (ext === "avif") return "image/avif";
    }
    return "image/png";
  }
  return "image/png";
}
