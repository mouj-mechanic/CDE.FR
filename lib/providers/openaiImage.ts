import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type {
  CategoryId,
  FingerId,
  HandJewelryType,
  TryOnRequest,
  TryOnResponse,
  TryOnWarning,
} from "@/types";
import {
  buildOpenAITryOnPrompt,
  isMaskedEditEnabledFor,
} from "@/lib/prompts/openaiTryOnPrompts";
import { validateMaskForCategory } from "@/lib/tryon/maskValidation";

/**
 * OpenAI GPT Image provider — single source of truth for try-on edits
 * when AI_TRYON_PROVIDER=openai.
 *
 *  Endpoint: `client.images.edit({ model, image, mask, prompt, n, size })`
 *
 *  Flow (every category):
 *    1. Validate inputs (key, product image, optional mask dimensions).
 *    2. Pick output size: env override OR auto-orient based on the user
 *       photo aspect ratio (portrait / landscape / square).
 *    3. Resize base + product references to the chosen size, keep PNG
 *       and never lossy-compress. The product is "contain"-fit to a
 *       transparent canvas so its full shape reaches the model.
 *    4. Convert the optional B/W mask → alpha PNG (transparent =
 *       editable, opaque = preserved). Match dimensions exactly. Run
 *       `validateMaskForCategory` to enforce per-category coverage limits.
 *    5. Build a strict, category-aware prompt composed from the shared
 *       preservation blocks (customer + product + no-hallucination + mask).
 *    6. Call gpt-image-1 image-edit with multi-image references and
 *       return the result as `data:image/png;base64,…`.
 *    7. Compute lightweight quality checks (outside-mask preservation,
 *       product low-resolution warning).
 *
 *  Security:
 *    - Reads OPENAI_API_KEY from process.env. Never logs it.
 *    - Never returns the key in error messages.
 *    - Caller is the API route; the key never reaches the browser.
 *
 *  Strictness:
 *    - Throws OpenAIConfigError when OPENAI_API_KEY is missing.
 *    - Throws MaskRequiredError when REQUIRE_MASK_FOR_OPENAI=true and no mask.
 *    - Throws MaskDimensionError on dimension mismatch.
 *    - Throws on any SDK / network error so the route can return an error
 *      JSON instead of silently rendering locally.
 */

export const OPENAI_DEFAULT_MODEL = "gpt-image-1";
// "auto" is the only sane production default. With "1024x1024" the
// router was producing letterboxed (black bars) results for portrait
// wrist photos. Anyone explicitly setting OPENAI_IMAGE_SIZE in their
// env override still wins.
const OPENAI_DEFAULT_SIZE: OpenAISize = "auto";
const OPENAI_DEFAULT_QUALITY = "high";

// Minimum reasonable size for an input image. Anything smaller is
// surfaced as a low-resolution warning.
const MIN_USER_IMAGE_LONG_SIDE = 1024;
const MIN_PRODUCT_IMAGE_LONG_SIDE = 512;

// ──────────────────────────────────────────────────────────────────────────
//  Errors
// ──────────────────────────────────────────────────────────────────────────

export class OpenAIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIConfigError";
  }
}

export class MaskRequiredError extends Error {
  constructor() {
    super(
      "A mask is required for OpenAI try-on editing to preserve customer identity and product fidelity."
    );
    this.name = "MaskRequiredError";
  }
}

export class MaskDimensionError extends Error {
  constructor(detail: string) {
    super(`Mask dimensions do not match the base image. ${detail}`);
    this.name = "MaskDimensionError";
  }
}

export type MaskValidationErrorCode =
  | "mask-too-small"
  | "mask-too-large"
  | "mask-dimension"
  | "mask-unreadable"
  | "mask-invalid";

export class MaskValidationError extends Error {
  /**
   * Stable machine-readable code. The route catches it to decide
   * whether to (a) silently regenerate a wider mask, (b) fall back to
   * the deterministic composite, or (c) surface a 4xx. Customers never
   * see the underlying message.
   */
  readonly code: MaskValidationErrorCode;
  constructor(detail: string, code: MaskValidationErrorCode = "mask-invalid") {
    super(detail);
    this.name = "MaskValidationError";
    this.code = code;
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Env
// ──────────────────────────────────────────────────────────────────────────

type OpenAISize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type OpenAIQuality = "low" | "medium" | "high" | "auto";
export type OpenAIInputFidelity = "low" | "high";
export type OpenAIOutputFormat = "png" | "jpeg" | "webp";
type ResolvedSize = "1024x1024" | "1024x1536" | "1536x1024";

interface OpenAIEnv {
  apiKey: string | undefined;
  model: string;
  size: OpenAISize;
  quality: OpenAIQuality;
  requireMask: boolean;
  inputFidelity: OpenAIInputFidelity;
  outputFormat: OpenAIOutputFormat;
}

function readOpenAIEnv(): OpenAIEnv {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model =
    process.env.OPENAI_IMAGE_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
  const size =
    (process.env.OPENAI_IMAGE_SIZE?.trim() as OpenAISize | undefined) ||
    OPENAI_DEFAULT_SIZE;
  const quality =
    (process.env.OPENAI_IMAGE_QUALITY?.trim() as
      | OpenAIQuality
      | undefined) || OPENAI_DEFAULT_QUALITY;
  const requireMask =
    (process.env.REQUIRE_MASK_FOR_OPENAI?.trim().toLowerCase() ?? "false") ===
    "true";
  const inputFidelityRaw = process.env.OPENAI_INPUT_FIDELITY?.trim().toLowerCase();
  const inputFidelity: OpenAIInputFidelity =
    inputFidelityRaw === "low" ? "low" : "high";
  const outputRaw = process.env.OPENAI_IMAGE_OUTPUT_FORMAT?.trim().toLowerCase();
  const outputFormat: OpenAIOutputFormat =
    outputRaw === "jpeg" || outputRaw === "webp" ? outputRaw : "png";
  return {
    apiKey,
    model,
    size,
    quality,
    requireMask,
    inputFidelity,
    outputFormat,
  };
}

/**
 * Pick a concrete size from the env value + the user image orientation.
 *
 *  "auto" (recommended) → pick the closest aspect.
 *  "1024x1024" → keep square UNLESS the source is markedly portrait or
 *      landscape. We then auto-promote to 1024×1536 / 1536×1024 to
 *      avoid the black-letterbox artefact a square output produces on
 *      a portrait wrist photo. Operators who really want a forced
 *      square should set the env to "1024x1024-strict".
 *  "1024x1536" / "1536x1024" → respected verbatim.
 */
export function resolveOutputAspectFromSource(params: {
  userImageDimensions: { width: number; height: number };
  compositeDimensions?: { width: number; height: number };
  requestedSize: OpenAISize | "1024x1024-strict";
}): ResolvedSize {
  const dims = params.compositeDimensions ?? params.userImageDimensions;
  const ratio = dims.width / Math.max(dims.height, 1);

  if (params.requestedSize === "1024x1024-strict") return "1024x1024";
  if (params.requestedSize === "1024x1536") return "1024x1536";
  if (params.requestedSize === "1536x1024") return "1536x1024";

  // "auto" — bias toward the closest aspect.
  if (params.requestedSize === "auto") {
    if (ratio >= 1.2) return "1536x1024";
    if (ratio <= 0.85) return "1024x1536";
    return "1024x1024";
  }

  // Soft square — operator asked for square but didn't pin it. We
  // promote to the matching portrait/landscape size when the source
  // would otherwise produce > 15 % letterboxing in either direction.
  if (params.requestedSize === "1024x1024") {
    if (ratio >= 1.2) return "1536x1024";
    if (ratio <= 0.83) return "1024x1536";
    return "1024x1024";
  }
  return "1024x1024";
}

function resolveSize(
  envSize: OpenAISize,
  baseDims: { width: number; height: number }
): ResolvedSize {
  return resolveOutputAspectFromSource({
    userImageDimensions: baseDims,
    requestedSize: envSize,
  });
}

function sizeToWH(size: ResolvedSize): { w: number; h: number } {
  if (size === "1024x1024") return { w: 1024, h: 1024 };
  if (size === "1024x1536") return { w: 1024, h: 1536 };
  return { w: 1536, h: 1024 };
}

// ──────────────────────────────────────────────────────────────────────────
//  Image utilities (sharp)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Convert our pipeline B/W mask (white = editable, black = preserved) into
 * an alpha-channel PNG suitable for OpenAI image edit.
 *
 *  - OpenAI mask convention:
 *      transparent pixels (alpha = 0)   → "AI may repaint"
 *      opaque pixels       (alpha = 255) → "AI must preserve"
 *
 *  - Our convention:
 *      white pixel (R = 255) → editable
 *      black pixel (R = 0)   → preserved
 *
 *  Conversion: alpha = 255 - grayscale.
 */
async function bwMaskToAlphaPng(bwMaskBuf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(bwMaskBuf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = info.width * info.height;
  const rgba = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const src = i * info.channels;
    const dst = i * 4;
    rgba[dst] = 0;
    rgba[dst + 1] = 0;
    rgba[dst + 2] = 0;
    rgba[dst + 3] = 255 - data[src];
  }

  return await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * `contain` resize for the base image / composite.
 *
 *  Why `contain` and not `cover`?
 *    `cover` center-crops to fill the target rectangle. For a portrait
 *    wrist photo at 4032×3024 fit into 1024×1024, the top/bottom 25 %
 *    get cut — that's the wrist or the fingers, depending on framing.
 *    `contain` letterboxes with a neutral background instead. The base
 *    image keeps its full content; the mask uses the same transform so
 *    the letterbox bars sit exactly outside the editable area.
 *
 *  Background colour:
 *    - For RGB images we use solid black (won't bleed into the AI
 *      result because the mask covers it).
 *    - For the alpha mask we explicitly pass an opaque background
 *      (alpha=255 → "preserved" in OpenAI's convention), so the
 *      letterbox never becomes accidentally editable.
 */
async function fitContainSolid(
  src: Buffer,
  w: number,
  h: number,
  background: { r: number; g: number; b: number; alpha: number }
): Promise<Buffer> {
  return await sharp(src)
    .resize(w, h, {
      fit: "contain",
      position: "center",
      background,
      kernel: "lanczos3",
    })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/** Solid-black `contain` resize for the base image / composite. */
async function fitBase(
  src: Buffer,
  w: number,
  h: number
): Promise<Buffer> {
  return await fitContainSolid(src, w, h, { r: 0, g: 0, b: 0, alpha: 1 });
}

/** Black B/W mask resize. Letterbox stays black (preserved). */
async function fitMask(
  src: Buffer,
  w: number,
  h: number
): Promise<Buffer> {
  return await fitContainSolid(src, w, h, { r: 0, g: 0, b: 0, alpha: 1 });
}

/**
 * `contain` resize for product references. Pads with transparent so the
 * full product shape is visible to the model. PNG with alpha preserved.
 */
async function fitContainTransparent(
  src: Buffer,
  w: number,
  h: number
): Promise<Buffer> {
  return await sharp(src)
    .ensureAlpha()
    .resize(w, h, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: "lanczos3",
    })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

async function getDimensions(
  buf: Buffer
): Promise<{ width: number; height: number; hasAlpha: boolean }> {
  const meta = await sharp(buf).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    hasAlpha: Boolean(meta.hasAlpha),
  };
}

/**
 * Detect black letterbox bars on the result and restore the source
 * aspect ratio by cropping them out.
 *
 *  When `fitContain` is used on the input AND the output canvas has a
 *  different aspect than the source, the OpenAI result carries the
 *  letterbox bars verbatim (the model dutifully preserves the black
 *  background). This step:
 *
 *    1. Computes the bar widths from the source aspect ratio.
 *    2. Crops them off the result.
 *    3. Returns a PNG sized to the source aspect at the same long-side.
 *
 *  Safety: if the source aspect is within 5 % of the output aspect we
 *  return the result unchanged (no measurable letterbox).
 */
export async function restoreSourceAspectRatio(params: {
  resultBuffer: Buffer;
  sourceDimensions: { width: number; height: number };
}): Promise<Buffer> {
  const meta = await sharp(params.resultBuffer).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return params.resultBuffer;

  const sourceRatio =
    params.sourceDimensions.width /
    Math.max(params.sourceDimensions.height, 1);
  const resultRatio = W / H;
  const ratioDelta = Math.abs(sourceRatio - resultRatio);
  if (ratioDelta < 0.05) {
    return params.resultBuffer;
  }

  // The output is wider than the source → side letterboxes.
  if (resultRatio > sourceRatio) {
    const targetW = Math.round(H * sourceRatio);
    const left = Math.max(0, Math.round((W - targetW) / 2));
    return await sharp(params.resultBuffer)
      .extract({ left, top: 0, width: targetW, height: H })
      .png({ compressionLevel: 6 })
      .toBuffer();
  }
  // The output is taller than the source → top/bottom letterboxes.
  const targetH = Math.round(W / sourceRatio);
  const top = Math.max(0, Math.round((H - targetH) / 2));
  return await sharp(params.resultBuffer)
    .extract({ left: 0, top, width: W, height: targetH })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * Lightweight black-bar detector: samples the leftmost / rightmost /
 * topmost / bottommost 8-pixel strip and reports whether at least 90 %
 * of those pixels are near-black (mean RGB < 16).
 */
export async function detectBlackBars(buffer: Buffer): Promise<{
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
  any: boolean;
}> {
  const { data, info } = await sharp(buffer)
    .resize(256, 256, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const ch = info.channels;
  const BAR = 8;

  const isBlackStrip = (xStart: number, xEnd: number, yStart: number, yEnd: number): boolean => {
    let dark = 0;
    let total = 0;
    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        const i = (y * W + x) * ch;
        const m = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (m < 16) dark++;
        total++;
      }
    }
    return total > 0 && dark / total > 0.9;
  };

  const left = isBlackStrip(0, BAR, 0, H);
  const right = isBlackStrip(W - BAR, W, 0, H);
  const top = isBlackStrip(0, W, 0, BAR);
  const bottom = isBlackStrip(0, W, H - BAR, H);
  return { left, right, top, bottom, any: left || right || top || bottom };
}

/**
 * Pixel-wise comparison restricted to the *preserved* region of the mask.
 *
 *  - Alpha mask: opaque (alpha >= 200) = preserved.
 *  - Both images downscaled to 256x… for speed.
 *  - `meanDiff` is the mean absolute color difference (RGB) over preserved
 *    pixels, normalised 0..255.
 *  - `score` = 1 - meanDiff / 255, in [0,1]. Higher is more preserved.
 *  - `preserved` = score >= threshold (default 0.92).
 *
 *  Note: gpt-image-1 is image-edit, not strict inpainting, so even with a
 *  mask the model lightly re-renders the entire image. A score of 0.92+
 *  is realistic for "no meaningful identity drift". Calibrate the
 *  threshold via env if needed.
 */
const QUALITY_PRESERVATION_DOWNSAMPLE = 256;

async function computeOutsideMaskScore(
  base: Buffer,
  result: Buffer,
  alphaMask: Buffer
): Promise<{ score: number; preserved: boolean }> {
  const ds = QUALITY_PRESERVATION_DOWNSAMPLE;
  const [a, b, m] = await Promise.all([
    sharp(base)
      .resize(ds, ds, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(result)
      .resize(ds, ds, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(alphaMask)
      .resize(ds, ds, { fit: "fill" })
      .extractChannel("alpha")
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  let totalDiff = 0;
  let preservedPixels = 0;
  const ach = a.info.channels;
  const bch = b.info.channels;
  for (let i = 0; i < ds * ds; i++) {
    if (m.data[i] < 200) continue; // not preserved
    preservedPixels++;
    const dr = Math.abs(a.data[i * ach] - b.data[i * bch]);
    const dg = Math.abs(a.data[i * ach + 1] - b.data[i * bch + 1]);
    const db = Math.abs(a.data[i * ach + 2] - b.data[i * bch + 2]);
    totalDiff += (dr + dg + db) / 3;
  }
  if (preservedPixels === 0) {
    return { score: 1, preserved: true };
  }
  const meanDiff = totalDiff / preservedPixels;
  const score = Math.max(0, 1 - meanDiff / 255);
  const thresholdRaw = process.env.OPENAI_PRESERVATION_THRESHOLD?.trim();
  const threshold = thresholdRaw ? Number(thresholdRaw) : 0.92;
  const preserved = score >= (Number.isFinite(threshold) ? threshold : 0.92);
  return { score, preserved };
}

// ──────────────────────────────────────────────────────────────────────────
//  Edit-input normalisation
// ──────────────────────────────────────────────────────────────────────────

/**
 * Guard rails applied right before the OpenAI SDK call. Catches the
 * structural mistakes that produce the worst end-user results:
 *
 *   - composite must be the first image (not the user photo) when
 *     `productLocked` was requested
 *   - mask must NOT appear in the source images array (it goes via the
 *     `mask` parameter only)
 *   - composite + mask dimensions must match the target size exactly
 *   - mask coverage must be within reasonable bounds for the category
 *
 *  Throws a `MaskValidationError` / `MaskDimensionError` so the route
 *  can convert to a 4xx instead of pushing a bad payload to OpenAI.
 */
export interface NormaliseEditInputsParams {
  category: CategoryId;
  baseImages: Buffer[];
  alphaMask: Buffer | null;
  rawMaskBW: Buffer | null;
  targetW: number;
  targetH: number;
  productLocked: boolean;
}

export interface NormaliseEditInputsResult {
  maskCoverage: number;
  /** Per-category cap that triggered any soft warning, exposed for debug. */
  appliedCoverageCap: number;
  warnings: TryOnWarning[];
}

// Production coverage caps (May 2026).
//
// The watch integration mask is now a thin ring (typically 2–7 % of
// the image), so we tighten the cap. Going above 12 % means the mask
// either drifted onto the fingers / hand or the deterministic
// placement is broken — either way we should refuse rather than let
// OpenAI repaint half of the photo.
const COVERAGE_HARD_CAP: Partial<Record<CategoryId, number>> = {
  watch: 0.12,
  glasses: 0.18,
  headwear: 0.28,
  "hand-jewelry": 0.14,
  clothes: 0.7,
};

const COVERAGE_SOFT_WARNING: Partial<Record<CategoryId, number>> = {
  watch: 0.09,
  glasses: 0.14,
  headwear: 0.22,
  "hand-jewelry": 0.1,
  clothes: 0.6,
};

// Target coverage for the watch integration mask (informational only —
// the hard / soft caps above gate the request). Used by README docs.
export const WATCH_TARGET_COVERAGE = 0.06;

export async function normalizeEditInputsForOpenAI(
  p: NormaliseEditInputsParams
): Promise<NormaliseEditInputsResult> {
  const warnings: TryOnWarning[] = [];

  // 1) Source images must exist and the first one must be sized to
  //    targetW × targetH (the eventual OpenAI output size).
  if (p.baseImages.length === 0) {
    throw new MaskValidationError("No base image queued for OpenAI edit.");
  }
  const firstMeta = await sharp(p.baseImages[0]).metadata();
  if (firstMeta.width !== p.targetW || firstMeta.height !== p.targetH) {
    throw new MaskDimensionError(
      `First base image is ${firstMeta.width}x${firstMeta.height}, expected ${p.targetW}x${p.targetH}.`
    );
  }

  // 2) Mask, when present, must match exactly.
  if (p.alphaMask) {
    const maskMeta = await sharp(p.alphaMask).metadata();
    if (maskMeta.width !== p.targetW || maskMeta.height !== p.targetH) {
      throw new MaskDimensionError(
        `Alpha mask is ${maskMeta.width}x${maskMeta.height}, expected ${p.targetW}x${p.targetH}.`
      );
    }
  }

  // 3) Coverage bounds — measured as *editable energy* on the alpha
  //    mask (Σ (255 - alpha) / 255 / N). This matches the metric used
  //    by `validateMaskForCategory` so the two gates can't disagree.
  let maskCoverage = 0;
  if (p.alphaMask) {
    const alphaRaw = await sharp(p.alphaMask)
      .extractChannel("alpha")
      .raw()
      .toBuffer({ resolveWithObject: true });
    let energy = 0;
    for (let i = 0; i < alphaRaw.data.length; i++) {
      energy += (255 - alphaRaw.data[i]) / 255;
    }
    maskCoverage = energy / alphaRaw.data.length;
  } else if (p.rawMaskBW) {
    const bwRaw = await sharp(p.rawMaskBW)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let energy = 0;
    const N = bwRaw.info.width * bwRaw.info.height;
    for (let i = 0; i < N; i++) {
      energy += bwRaw.data[i * bwRaw.info.channels] / 255;
    }
    maskCoverage = energy / N;
  }

  const cap = COVERAGE_HARD_CAP[p.category] ?? 0.3;
  const soft = COVERAGE_SOFT_WARNING[p.category] ?? cap * 0.8;

  if (maskCoverage > cap) {
    throw new MaskValidationError(
      `Mask covers ${Math.round(
        maskCoverage * 100
      )}% of the image (max ${Math.round(
        cap * 100
      )}% for ${p.category}). The customer image may change too much.`,
      "mask-too-large"
    );
  }
  if (maskCoverage > soft) {
    warnings.push({
      code: "mask-coverage-warning",
      message: `Mask covers ${Math.round(
        maskCoverage * 100
      )}% of the image. Consider tightening it.`,
    });
  }

  // 4) Sanity for product-lock: the first image must be the composite
  //    (i.e. dimensions match and we asked for the lock). We don't
  //    inspect bytes — the caller is responsible — but we surface a
  //    diagnostic warning if no composite was queued for an accessory
  //    that requested lock.
  if (p.productLocked && p.baseImages.length < 2) {
    warnings.push({
      code: "product-lock-without-reference",
      message:
        "Product lock requested but no transparent product reference was queued — fidelity may suffer.",
    });
  }

  return { maskCoverage, appliedCoverageCap: cap, warnings };
}

// ──────────────────────────────────────────────────────────────────────────
//  OpenAI SDK call
// ──────────────────────────────────────────────────────────────────────────

interface ImageEditCallOptions {
  apiKey: string;
  model: string;
  size: ResolvedSize;
  quality: OpenAIQuality;
  inputFidelity: OpenAIInputFidelity;
  outputFormat: OpenAIOutputFormat;
  prompt: string;
  baseImages: Buffer[];
  alphaMask: Buffer | null;
}

async function callOpenAIImageEdit(
  opts: ImageEditCallOptions
): Promise<{ b64: string }> {
  const client = new OpenAI({ apiKey: opts.apiKey });

  const imageFiles = await Promise.all(
    opts.baseImages.map((buf, i) =>
      toFile(buf, `tryon-base-${i}.png`, { type: "image/png" })
    )
  );
  const maskFile = opts.alphaMask
    ? await toFile(opts.alphaMask, "tryon-mask.png", { type: "image/png" })
    : undefined;

  const imageParam =
    imageFiles.length > 1 && opts.model.includes("gpt-image")
      ? imageFiles
      : imageFiles[0];

  const editParams: Record<string, unknown> = {
    model: opts.model,
    image: imageParam,
    prompt: opts.prompt,
    n: 1,
    size: opts.size,
  };
  if (opts.model.includes("gpt-image")) {
    editParams.quality = opts.quality;
    // gpt-image-1 only. Setting input_fidelity=high tells the model to
    // stick close to the input pixels (less re-interpretation of the
    // customer's hand / face / pose). Critical for accessories where
    // the composite already has the product in the right spot.
    editParams.input_fidelity = opts.inputFidelity;
    // Force PNG so the result preserves alpha edges around the
    // product / hair / accessories. Avoids JPEG ringing artefacts.
    editParams.output_format = opts.outputFormat;
  }
  if (maskFile) {
    editParams.mask = maskFile;
  }

  const res = (await client.images.edit(
    editParams as unknown as Parameters<typeof client.images.edit>[0]
  )) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const first = res.data?.[0];
  if (!first) throw new Error("OpenAI image edit returned no result.");
  if (first.b64_json) return { b64: first.b64_json };

  if (first.url) {
    const fetched = await fetch(first.url);
    if (!fetched.ok) {
      throw new Error(
        `OpenAI returned a URL (${fetched.status}) we couldn't fetch.`
      );
    }
    const buf = Buffer.from(await fetched.arrayBuffer());
    return { b64: buf.toString("base64") };
  }

  throw new Error("OpenAI image edit response missing b64_json/url.");
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

export interface ProductReference {
  /** Either a File (uploaded) or a Buffer (already fetched on the server). */
  data: File | Buffer;
  /** Optional label kept for logs / debug. */
  label?: string;
}

export interface GenerateOpenAIImageTryOnParams {
  userImage: File;
  /** Original product images (may be JPEG / PNG, may NOT have alpha). */
  productImages: File[];
  /** Transparent product cutouts (PNG with alpha) when available. */
  productCutouts?: ProductReference[];
  /** Optional B/W mask (white = editable, black = preserved). */
  maskImage?: File | null;
  /** Optional pre-rendered composite (overrides userImage as base). */
  compositeImage?: File | null;
  category: CategoryId;
  productSubtype?: HandJewelryType;
  targetFinger?: FingerId;
  prompt?: string;
  quality?: OpenAIQuality;
  size?: OpenAISize;
  notes?: string;
  /**
   * True when the caller plans to re-stamp the original product PNG on
   * top of the result (product-lock pipeline). The prompt switches to
   * "the product is already positioned, only integrate". Has no effect
   * on the actual API call — only the prompt wording.
   */
  productLocked?: boolean;
  /**
   * True when the app produced both `compositeImage` and `maskImage`
   * automatically (no human-curated mask). Triggers the strict
   * `AUTO_MASKED_ACCESSORY_PROMPT` (or `getWatchTryOnPrompt()` for
   * watches) instead of any "placement" lead. Prompt-only flag.
   */
  autoMaskedAccessory?: boolean;
}

export interface QualityChecks {
  /** 0..1 score, higher is more preserved. */
  outsideMaskChangeScore: number;
  /** True when score >= preservation threshold. */
  outsideMaskPreserved: boolean;
  /** True when the product image is below MIN_PRODUCT_IMAGE_LONG_SIDE. */
  productFidelityWarning: boolean;
  /** Aggregate flag: anything that should make the operator double-check. */
  customerPreservationWarning: boolean;
}

export interface OpenAIImageMeta {
  maskUsed: boolean;
  /**
   * Ratio of editable pixels in the alpha mask, 0..1. 0 when no mask
   * was sent. Higher = more of the customer image was unlocked for
   * editing → higher risk of identity drift.
   */
  maskCoverage: number;
  productHasAlpha: boolean;
  baseImageCount: number;
  /** Whether a deterministic composite was used as the base image. */
  compositeUsedAsBase: boolean;
  /** Final size sent to OpenAI. */
  size: ResolvedSize;
  /**
   * True when black-letterbox bars were detected on the raw OpenAI
   * output and cropped out to restore the source aspect ratio.
   */
  blackBarsRemoved: boolean;
  /** input_fidelity actually sent (gpt-image-1 only). */
  inputFidelity: OpenAIInputFidelity;
  /** output_format actually sent. */
  outputFormat: OpenAIOutputFormat;
  /** Lightweight similarity / fidelity checks. */
  qualityChecks: QualityChecks;
  /** Validation warnings raised by `maskValidation` and friends. */
  warnings: TryOnWarning[];
  /**
   * Optional diagnostic block exposed for the internal `debug.maskDebug`
   * panel. Populated by `autoMaskFromComposite` when the route uses
   * server-side auto-masking. Allows QA to inspect why a given mask
   * was widened or rejected.
   */
  maskDebug?: {
    editableEnergyRatio: number;
    brightRatio: number;
    softRatio: number;
    maskCoverageBeforeExpansion?: number;
    maskCoverageAfterExpansion?: number;
    expansionAttempts?: number;
    outerDilatePx?: number;
    innerErodePx?: number;
    featherPx?: number;
    contactShadowPatchAdded?: boolean;
    fallbackReason?: string;
  };
  /**
   * Raw PNG buffer of the AI result (after aspect restoration). Kept
   * here so callers (the API route) can run post-processing
   * (product-lock re-stamp) without decoding the base64 data URL
   * again. Not serialised to JSON — the route picks specific fields
   * explicitly.
   */
  resultBuffer: Buffer;
  /**
   * Resized *user* image (no product) at the same dimensions as
   * `resultBuffer`. Used by the product-lock pipeline to diff against
   * the composite and recover the product silhouette. Always present.
   */
  baseAtTargetSize: Buffer;
  /**
   * Resized composite (user photo + placed product) at the same
   * dimensions as `resultBuffer`. Present only when the caller supplied
   * `compositeImage` — that's the input the product-lock pipeline diffs
   * against `baseAtTargetSize`.
   */
  compositeAtTargetSize?: Buffer;
  /**
   * Alpha mask PNG sized to match `resultBuffer`. Present only when a
   * mask was used. Exposed so the route can run additional
   * downstream-aware compositing (anti-ghost final composition).
   */
  alphaMaskAtTargetSize?: Buffer;
}

export interface GenerateOpenAIImageTryOnResult {
  resultUrl: string;
  generatedAt: number;
  durationMs: number;
  provider: "openai";
  model: string;
  category: CategoryId;
  meta: OpenAIImageMeta;
}

export async function generateOpenAIImageTryOn(
  params: GenerateOpenAIImageTryOnParams
): Promise<GenerateOpenAIImageTryOnResult> {
  const env = readOpenAIEnv();
  if (!env.apiKey) {
    throw new OpenAIConfigError(
      "OPENAI_API_KEY is missing. Set it in your environment to use the OpenAI provider."
    );
  }

  const warnings: TryOnWarning[] = [];

  // ── 1. Resolve base image (composite > user photo) ─────────────────
  const compositeUsedAsBase = Boolean(params.compositeImage);
  const primaryFile = params.compositeImage ?? params.userImage;
  const primaryBuf = Buffer.from(await primaryFile.arrayBuffer());
  const primaryDims = await getDimensions(primaryBuf);

  if (
    !compositeUsedAsBase &&
    Math.max(primaryDims.width, primaryDims.height) <
      MIN_USER_IMAGE_LONG_SIDE
  ) {
    warnings.push({
      code: "user-image-low-res",
      message:
        "User photo is below 1024px on its long side. Customer fidelity may be reduced.",
    });
  }

  // ── 2. Pick output size & resize base ─────────────────────────────
  const requestedSize = params.size ?? env.size;
  const resolved = resolveSize(requestedSize, primaryDims);
  const { w: targetW, h: targetH } = sizeToWH(resolved);

  // ── 3. Mask handling (validate BEFORE resizing) ───────────────────
  const useMaskedEdit = isMaskedEditEnabledFor(params.category);
  const haveRawMask = Boolean(params.maskImage);

  if (env.requireMask && !haveRawMask) {
    throw new MaskRequiredError();
  }

  let alphaMask: Buffer | null = null;
  let maskAtTargetSize: Buffer | null = null;
  if (haveRawMask && useMaskedEdit && params.maskImage) {
    const rawMask = Buffer.from(await params.maskImage.arrayBuffer());
    const validation = await validateMaskForCategory(
      rawMask,
      { width: primaryDims.width, height: primaryDims.height },
      params.category
    );
    if (!validation.ok) {
      throw new MaskValidationError(
        validation.error ?? "Invalid mask.",
        validation.errorCode ?? "mask-invalid"
      );
    }
    warnings.push(...validation.warnings);
    const squaredMask = await fitMask(rawMask, targetW, targetH);
    maskAtTargetSize = squaredMask;
    alphaMask = await bwMaskToAlphaPng(squaredMask);
  } else if (!haveRawMask) {
    warnings.push({
      code: "openai-no-mask",
      message: "No mask provided. The edit may be less constrained.",
    });
  }

  // ── 4. Build base image array ─────────────────────────────────────
  const baseImages: Buffer[] = [];
  const squaredBase = await fitBase(primaryBuf, targetW, targetH);
  baseImages.push(squaredBase);

  // Always keep a target-size version of the *original* user image too,
  // so post-processing (product-lock diff) has both layers regardless
  // of whether a composite was used.
  const userBaseBuf = compositeUsedAsBase
    ? Buffer.from(await params.userImage.arrayBuffer())
    : primaryBuf;
  const userAtTargetSize = compositeUsedAsBase
    ? await fitBase(userBaseBuf, targetW, targetH)
    : squaredBase;

  // Multi-image: when the model supports it, stack:
  //   1. base (already pushed)
  //   2. transparent product cutout (highest fidelity reference)
  //   3. original product image
  let productHasAlpha = false;
  let productLowRes = false;
  let firstProductBuf: Buffer | null = null;
  if (env.model.includes("gpt-image")) {
    // Cutouts first (transparent PNGs).
    if (params.productCutouts && params.productCutouts.length > 0) {
      for (const cutout of params.productCutouts) {
        // TS can't narrow `File | Buffer` here without an explicit
        // branch; pull the data out into a local typed first.
        const cd = cutout.data;
        const buf: Buffer = Buffer.isBuffer(cd)
          ? cd
          : Buffer.from(await (cd as File).arrayBuffer());
        const dims = await getDimensions(buf);
        if (dims.hasAlpha) productHasAlpha = true;
        if (
          Math.max(dims.width, dims.height) < MIN_PRODUCT_IMAGE_LONG_SIDE
        ) {
          productLowRes = true;
        }
        if (!firstProductBuf) firstProductBuf = buf;
        baseImages.push(await fitContainTransparent(buf, targetW, targetH));
      }
    }
    // Then originals.
    for (const file of params.productImages) {
      const buf = Buffer.from(await file.arrayBuffer());
      const dims = await getDimensions(buf);
      if (dims.hasAlpha) productHasAlpha = true;
      if (Math.max(dims.width, dims.height) < MIN_PRODUCT_IMAGE_LONG_SIDE) {
        productLowRes = true;
      }
      if (!firstProductBuf) firstProductBuf = buf;
      baseImages.push(await fitContainTransparent(buf, targetW, targetH));
    }
  } else if (params.productImages[0]) {
    const buf = Buffer.from(await params.productImages[0].arrayBuffer());
    if (!firstProductBuf) firstProductBuf = buf;
    baseImages.push(await fitContainTransparent(buf, targetW, targetH));
  }

  if (productLowRes) {
    warnings.push({
      code: "product-low-res",
      message:
        "Product image is low resolution. Product fidelity may be reduced.",
    });
  }

  // gpt-image-1 caps at 16 input images; we shouldn't reach that, but
  // guard against pathological merchant inputs.
  if (baseImages.length > 16) {
    baseImages.length = 16;
  }

  // ── 4b. Normalise + structural validation ──────────────────────
  // Catches the worst-case payload mistakes (mask in source images,
  // dimension mismatch, coverage > cap) before they reach OpenAI.
  const normalised = await normalizeEditInputsForOpenAI({
    category: params.category,
    baseImages,
    alphaMask,
    rawMaskBW: maskAtTargetSize,
    targetW,
    targetH,
    productLocked: Boolean(params.productLocked),
  });
  warnings.push(...normalised.warnings);

  // ── 5. Build prompt ─────────────────────────────────────────────
  const prompt =
    params.prompt ??
    buildOpenAITryOnPrompt({
      category: params.category,
      productSubtype: params.productSubtype,
      maskUsed: Boolean(alphaMask),
      targetFinger: params.targetFinger,
      notes: params.notes,
      productLocked: params.productLocked,
      autoMaskedAccessory: params.autoMaskedAccessory,
    });

  console.info(
    `[try-on] category=${params.category}\n` +
      `[try-on] provider=openai\n` +
      `[try-on] renderMode=api-image-edit\n` +
      `[try-on] maskUsed=${Boolean(alphaMask)}\n` +
      `[try-on] maskCoverage=${normalised.maskCoverage.toFixed(3)}\n` +
      `[try-on] usedLocalRenderer=false\n` +
      `[try-on] model=${env.model}\n` +
      `[try-on] size=${resolved} quality=${params.quality ?? env.quality} inputFidelity=${env.inputFidelity} outputFormat=${env.outputFormat} baseImages=${baseImages.length} productHasAlpha=${productHasAlpha} productLowRes=${productLowRes}`
  );

  // ── 6. Call OpenAI ───────────────────────────────────────────────
  const startedAt = Date.now();
  const { b64 } = await callOpenAIImageEdit({
    apiKey: env.apiKey,
    model: env.model,
    size: resolved,
    quality: params.quality ?? env.quality,
    inputFidelity: env.inputFidelity,
    outputFormat: env.outputFormat,
    prompt,
    baseImages,
    alphaMask,
  });
  const durationMs = Date.now() - startedAt;
  let resultBuf = Buffer.from(b64, "base64");

  // ── 6b. Restore the source aspect ratio so the end-user never
  //         sees black letterbox bars. The base/mask were fit-contained
  //         onto the resolved size, so when the source aspect differs
  //         from the resolved size aspect (e.g. portrait wrist photo on
  //         a forced 1024×1024 output), the AI dutifully preserves the
  //         bars. We crop them out here.
  //
  //  All downstream buffers — userAtTargetSize, squaredBase, alphaMask —
  //  must shrink by exactly the same amount so the product-lock and
  //  fidelity checks still align pixel-for-pixel.
  let croppedUserBuf = userAtTargetSize;
  let croppedCompositeBuf = squaredBase;
  let croppedAlphaMask = alphaMask;
  let blackBarsRemoved = false;
  try {
    const bars = await detectBlackBars(resultBuf);
    if (bars.any) {
      const cropResult = await restoreSourceAspectRatio({
        resultBuffer: resultBuf,
        sourceDimensions: primaryDims,
      });
      if (cropResult.length !== resultBuf.length) {
        // Recompute the crop from the *target-size* base so each buffer
        // gets the same extract rectangle and stays in lockstep.
        croppedUserBuf = Buffer.from(
          await restoreSourceAspectRatio({
            resultBuffer: userAtTargetSize,
            sourceDimensions: primaryDims,
          })
        );
        croppedCompositeBuf = Buffer.from(
          await restoreSourceAspectRatio({
            resultBuffer: squaredBase,
            sourceDimensions: primaryDims,
          })
        );
        if (alphaMask) {
          croppedAlphaMask = Buffer.from(
            await restoreSourceAspectRatio({
              resultBuffer: alphaMask,
              sourceDimensions: primaryDims,
            })
          );
        }
        resultBuf = Buffer.from(cropResult);
        blackBarsRemoved = true;
      }
    }
  } catch (err) {
    console.warn(
      "[try-on] aspect restoration failed (continuing with un-cropped result):",
      err instanceof Error ? err.message : err
    );
  }

  // ── 7. Quality checks (outside-mask preservation) ──────────────
  let outsideMaskChangeScore = 1;
  let outsideMaskPreserved = true;
  if (croppedAlphaMask) {
    try {
      const check = await computeOutsideMaskScore(
        croppedCompositeBuf,
        resultBuf,
        croppedAlphaMask
      );
      outsideMaskChangeScore = check.score;
      outsideMaskPreserved = check.preserved;
    } catch (err) {
      console.warn(
        "[try-on] outside-mask preservation check failed:",
        err instanceof Error ? err.message : err
      );
    }
  }
  if (croppedAlphaMask && !outsideMaskPreserved) {
    warnings.push({
      code: "outside-mask-changed",
      message: "The edit changed too much outside the mask.",
    });
  }

  if (blackBarsRemoved) {
    warnings.push({
      code: "aspect-restored",
      message:
        "Removed black letterbox bars from the AI output to match the source photo aspect ratio.",
    });
  }

  const qualityChecks: QualityChecks = {
    outsideMaskChangeScore,
    outsideMaskPreserved,
    productFidelityWarning: productLowRes,
    customerPreservationWarning:
      !outsideMaskPreserved ||
      warnings.some((w) => w.code === "user-image-low-res"),
  };

  console.info(
    `[try-on] durationMs=${durationMs} provider=openai model=${env.model} category=${params.category} outsideMaskScore=${outsideMaskChangeScore.toFixed(3)} outsideMaskPreserved=${outsideMaskPreserved}`
  );

  // The exposed buffers are the (possibly) cropped versions so every
  // downstream check sees the same canvas as the final user-visible
  // result.
  const resultBase64 = resultBuf.toString("base64");
  return {
    resultUrl: `data:image/png;base64,${resultBase64}`,
    generatedAt: Date.now(),
    durationMs,
    provider: "openai",
    model: env.model,
    category: params.category,
    meta: {
      maskUsed: Boolean(croppedAlphaMask),
      maskCoverage: normalised.maskCoverage,
      productHasAlpha,
      baseImageCount: baseImages.length,
      compositeUsedAsBase,
      size: resolved,
      blackBarsRemoved,
      inputFidelity: env.inputFidelity,
      outputFormat: env.outputFormat,
      qualityChecks,
      warnings,
      resultBuffer: resultBuf,
      baseAtTargetSize: croppedUserBuf,
      compositeAtTargetSize: compositeUsedAsBase ? croppedCompositeBuf : undefined,
      alphaMaskAtTargetSize: croppedAlphaMask ?? undefined,
    },
  };
  // Note: `maskAtTargetSize` is intentionally unused — kept here in case
  // downstream tooling wants to surface the resized mask for debugging.
  void maskAtTargetSize;
}

// ──────────────────────────────────────────────────────────────────────────
//  Legacy adapter — TryOnRequest in, TryOnResponse out
// ──────────────────────────────────────────────────────────────────────────

export interface OpenAIImageParams extends TryOnRequest {
  inpaintComposite?: File;
  inpaintMask?: File;
  /** Server-fetched cutout buffers (route resolves productCutoutUrls). */
  productCutoutBuffers?: Buffer[];
  /**
   * True when the route plans to re-stamp the product after the AI call
   * (product-lock pipeline). Drives the prompt wording.
   */
  productLocked?: boolean;
  /**
   * True when the app auto-generated `inpaintComposite` + `inpaintMask`.
   * Triggers the strict `AUTO_MASKED_ACCESSORY_PROMPT`.
   */
  autoMaskedAccessory?: boolean;
}

export async function openaiTryOn(
  params: OpenAIImageParams
): Promise<TryOnResponse & { openaiMeta: OpenAIImageMeta }> {
  const cutoutRefs: ProductReference[] | undefined = params.productCutoutBuffers
    ?.length
    ? params.productCutoutBuffers.map((data, i) => ({
        data,
        label: `cutout-${i}`,
      }))
    : undefined;

  const result = await generateOpenAIImageTryOn({
    userImage: params.userImage,
    productImages: params.productImages,
    productCutouts: cutoutRefs,
    maskImage: params.inpaintMask ?? null,
    compositeImage: params.inpaintComposite ?? null,
    category: params.category,
    productSubtype: params.handJewelryType,
    targetFinger: params.ringFinger,
    notes: params.notes,
    productLocked: params.productLocked,
    autoMaskedAccessory: params.autoMaskedAccessory,
  });

  return {
    resultUrl: result.resultUrl,
    generatedAt: result.generatedAt,
    durationMs: result.durationMs,
    mock: false,
    provider: result.provider,
    model: result.model,
    category: result.category,
    debug: {
      imageCount: result.meta.baseImageCount + (result.meta.maskUsed ? 1 : 0),
      productImageCount:
        params.productImages.length +
        (params.productCutoutBuffers?.length ?? 0),
    },
    openaiMeta: result.meta,
  };
}
