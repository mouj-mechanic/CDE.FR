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
const OPENAI_DEFAULT_SIZE = "1024x1024";
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

export class MaskValidationError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "MaskValidationError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Env
// ──────────────────────────────────────────────────────────────────────────

type OpenAISize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type OpenAIQuality = "low" | "medium" | "high" | "auto";
type ResolvedSize = "1024x1024" | "1024x1536" | "1536x1024";

interface OpenAIEnv {
  apiKey: string | undefined;
  model: string;
  size: OpenAISize;
  quality: OpenAIQuality;
  requireMask: boolean;
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
  return { apiKey, model, size, quality, requireMask };
}

/** Pick a concrete size from the env value + the user image orientation. */
function resolveSize(
  envSize: OpenAISize,
  baseDims: { width: number; height: number }
): ResolvedSize {
  if (envSize === "1024x1024") return "1024x1024";
  if (envSize === "1024x1536") return "1024x1536";
  if (envSize === "1536x1024") return "1536x1024";
  // auto
  const ratio = baseDims.width / Math.max(baseDims.height, 1);
  if (ratio > 1.15) return "1536x1024"; // landscape
  if (ratio < 0.87) return "1024x1536"; // portrait
  return "1024x1024";
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
 * `cover` resize to the chosen rectangle. Used for the base image and
 * the mask. Center-crop preserves the body part of interest (wrist / face
 * / torso usually framed at the centre).
 */
async function fitCover(
  src: Buffer,
  w: number,
  h: number
): Promise<Buffer> {
  return await sharp(src)
    .resize(w, h, { fit: "cover", position: "center", kernel: "lanczos3" })
    .png({ compressionLevel: 6 })
    .toBuffer();
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
//  OpenAI SDK call
// ──────────────────────────────────────────────────────────────────────────

interface ImageEditCallOptions {
  apiKey: string;
  model: string;
  size: ResolvedSize;
  quality: OpenAIQuality;
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
  productHasAlpha: boolean;
  baseImageCount: number;
  /** Whether a deterministic composite was used as the base image. */
  compositeUsedAsBase: boolean;
  /** Final size sent to OpenAI. */
  size: ResolvedSize;
  /** Lightweight similarity / fidelity checks. */
  qualityChecks: QualityChecks;
  /** Validation warnings raised by `maskValidation` and friends. */
  warnings: TryOnWarning[];
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
      throw new MaskValidationError(validation.error ?? "Invalid mask.");
    }
    warnings.push(...validation.warnings);
    const squaredMask = await fitCover(rawMask, targetW, targetH);
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
  const squaredBase = await fitCover(primaryBuf, targetW, targetH);
  baseImages.push(squaredBase);

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

  // ── 5. Build prompt ─────────────────────────────────────────────
  const prompt =
    params.prompt ??
    buildOpenAITryOnPrompt({
      category: params.category,
      productSubtype: params.productSubtype,
      maskUsed: Boolean(alphaMask),
      targetFinger: params.targetFinger,
      notes: params.notes,
    });

  console.info(
    `[try-on] category=${params.category}\n` +
      `[try-on] provider=openai\n` +
      `[try-on] renderMode=api-image-edit\n` +
      `[try-on] maskUsed=${Boolean(alphaMask)}\n` +
      `[try-on] usedLocalRenderer=false\n` +
      `[try-on] model=${env.model}\n` +
      `[try-on] size=${resolved} quality=${params.quality ?? env.quality} baseImages=${baseImages.length} productHasAlpha=${productHasAlpha} productLowRes=${productLowRes}`
  );

  // ── 6. Call OpenAI ───────────────────────────────────────────────
  const startedAt = Date.now();
  const { b64 } = await callOpenAIImageEdit({
    apiKey: env.apiKey,
    model: env.model,
    size: resolved,
    quality: params.quality ?? env.quality,
    prompt,
    baseImages,
    alphaMask,
  });
  const durationMs = Date.now() - startedAt;
  const resultBuf = Buffer.from(b64, "base64");

  // ── 7. Quality checks (outside-mask preservation) ──────────────
  let outsideMaskChangeScore = 1;
  let outsideMaskPreserved = true;
  if (alphaMask) {
    try {
      const check = await computeOutsideMaskScore(
        squaredBase,
        resultBuf,
        alphaMask
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
  if (alphaMask && !outsideMaskPreserved) {
    warnings.push({
      code: "outside-mask-changed",
      message: "The edit changed too much outside the mask.",
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

  return {
    resultUrl: `data:image/png;base64,${b64}`,
    generatedAt: Date.now(),
    durationMs,
    provider: "openai",
    model: env.model,
    category: params.category,
    meta: {
      maskUsed: Boolean(alphaMask),
      productHasAlpha,
      baseImageCount: baseImages.length,
      compositeUsedAsBase,
      size: resolved,
      qualityChecks,
      warnings,
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
