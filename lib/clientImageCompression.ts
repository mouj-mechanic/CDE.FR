"use client";

/**
 * Client-side image compression helpers.
 *
 * Vercel's serverless runtime caps request bodies at 4.5 MB. Phone photos
 * (4032×3024 ≈ 4–6 MB JPEG, 12+ MB PNG) plus the deterministic preview
 * (PNG, same dimensions) easily exceed that. We downscale + re-encode
 * client-side before uploading so the API never returns a non-JSON
 * "Request Entity Too Large" error.
 */

const DEFAULT_MAX_DIM = 1600;
const DEFAULT_QUALITY = 0.88;

export interface CompressionOptions {
  /** Longest-side cap in pixels (default 1600). */
  maxDim?: number;
  /** JPEG/WebP quality in [0..1] (default 0.88). */
  quality?: number;
  /** Output MIME type ("image/jpeg" by default). */
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
  /** Optional file name override. */
  fileName?: string;
  /**
   * Skip compression if the file is already smaller than this byte count
   * AND its longest side fits within maxDim. Default: 1.4 MB.
   */
  skipIfSmallerThan?: number;
}

/**
 * Downscale + re-encode a File. If the file already fits the size and
 * dimension caps it is returned unchanged (cheap fast path).
 */
export async function compressImageFile(
  file: File,
  opts: CompressionOptions = {}
): Promise<File> {
  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const mime = opts.mimeType ?? "image/jpeg";
  const skipBytes = opts.skipIfSmallerThan ?? 1.4 * 1024 * 1024;

  const bitmap = await loadBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (file.size <= skipBytes && longest <= maxDim) {
    if ("close" in bitmap) bitmap.close();
    return file;
  }

  const blob = await encodeBitmap(bitmap, maxDim, mime, quality);
  if ("close" in bitmap) bitmap.close();
  const name = opts.fileName ?? renameForMime(file.name || "upload", mime);
  return new File([blob], name, { type: mime });
}

/**
 * Downscale + re-encode a Blob. Used for the canvas preview which is
 * created in-memory and has no associated File.
 */
export async function compressImageBlob(
  blob: Blob,
  opts: CompressionOptions = {}
): Promise<Blob> {
  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const mime = opts.mimeType ?? "image/jpeg";

  const bitmap = await loadBitmap(blob);
  const out = await encodeBitmap(bitmap, maxDim, mime, quality);
  if ("close" in bitmap) bitmap.close();
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
//  internals
// ──────────────────────────────────────────────────────────────────────────

type DecodedBitmap = ImageBitmap | HTMLImageElement;

async function loadBitmap(source: Blob | File): Promise<DecodedBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(source);
    } catch {
      // Fall through to HTMLImageElement path.
    }
  }
  const url = URL.createObjectURL(source);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image decode failed."));
      img.src = url;
    });
  } finally {
    // Don't revoke immediately; the HTMLImageElement may still draw from it.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

async function encodeBitmap(
  bitmap: DecodedBitmap,
  maxDim: number,
  mime: string,
  quality: number
): Promise<Blob> {
  const srcW = "width" in bitmap ? bitmap.width : 0;
  const srcH = "height" in bitmap ? bitmap.height : 0;
  if (!srcW || !srcH) throw new Error("Image has zero dimensions.");

  const longest = Math.max(srcW, srcH);
  const scale = longest > maxDim ? maxDim / longest : 1;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, dstW, dstH);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas encode failed."))),
      mime,
      quality
    );
  });
}

function renameForMime(name: string, mime: string): string {
  const ext =
    mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  const stem = name.replace(/\.[^.]+$/, "");
  return `${stem || "upload"}${ext}`;
}
