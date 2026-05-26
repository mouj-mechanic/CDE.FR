import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type {
  CategoryId,
  FingerId,
  HandJewelryType,
  TryOnRequest,
  TryOnResponse,
} from "@/types";
import {
  buildOpenAITryOnPrompt,
  isMaskedEditEnabledFor,
} from "@/lib/prompts/openaiTryOnPrompts";

/**
 * OpenAI GPT Image provider — *single source of truth* for try-on edits
 * when AI_TRYON_PROVIDER=openai.
 *
 *  Endpoint: `client.images.edit({ model, image, mask, prompt, n, size })`
 *
 *  Flow (every category):
 *    1. Validate inputs (key, product image, optional mask dimensions).
 *    2. Square-pad user/composite + product images to the target size.
 *    3. Convert the optional B/W mask → alpha PNG (transparent =
 *       editable, opaque = preserved). Match dimensions exactly.
 *    4. Build a strict, category-aware prompt (per-finger for rings,
 *       per-subtype for bracelets, etc.).
 *    5. Call gpt-image-1 image-edit and return the result as a
 *       `data:image/png;base64,…` URL.
 *
 *  Security:
 *    - Reads OPENAI_API_KEY from process.env. Never logs it.
 *    - Never returns the key in error messages.
 *    - Caller is the API route; the key never reaches the browser.
 *
 *  Strictness:
 *    - Throws a typed `OpenAIConfigError` when OPENAI_API_KEY is missing.
 *    - Throws a typed `MaskRequiredError` when REQUIRE_MASK_FOR_OPENAI=true
 *      and no mask was supplied.
 *    - Throws on dimension mismatch between mask and base image.
 */

export const OPENAI_DEFAULT_MODEL = "gpt-image-1";
const OPENAI_DEFAULT_SIZE = "1024x1024";
const OPENAI_DEFAULT_QUALITY = "high";

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
      "Mask is required for API-only OpenAI editing but no mask was provided."
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

// ──────────────────────────────────────────────────────────────────────────
//  Env
// ──────────────────────────────────────────────────────────────────────────

interface OpenAIEnv {
  apiKey: string | undefined;
  model: string;
  size: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  quality: "low" | "medium" | "high" | "auto";
  requireMask: boolean;
}

function readOpenAIEnv(): OpenAIEnv {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model =
    process.env.OPENAI_IMAGE_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
  const size =
    (process.env.OPENAI_IMAGE_SIZE?.trim() as OpenAIEnv["size"] | undefined) ||
    OPENAI_DEFAULT_SIZE;
  const quality =
    (process.env.OPENAI_IMAGE_QUALITY?.trim() as
      | OpenAIEnv["quality"]
      | undefined) || OPENAI_DEFAULT_QUALITY;
  const requireMask =
    (process.env.REQUIRE_MASK_FOR_OPENAI?.trim().toLowerCase() ?? "false") ===
    "true";
  return { apiKey, model, size, quality, requireMask };
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
 *  - Our convention (and the spec for manual masks uploaded by the user):
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
 * Square-resize for OpenAI. Uses `cover` so the body part stays centred
 * (the wrist/face/torso is typically near the centre — preferable to
 * losing pixels via `contain`).
 */
async function squareForOpenAI(
  src: Buffer,
  targetSize: number
): Promise<Buffer> {
  return await sharp(src)
    .resize(targetSize, targetSize, { fit: "cover", position: "center" })
    .png()
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

// ──────────────────────────────────────────────────────────────────────────
//  OpenAI SDK call
// ──────────────────────────────────────────────────────────────────────────

interface ImageEditCallOptions {
  apiKey: string;
  model: string;
  size: OpenAIEnv["size"];
  quality: OpenAIEnv["quality"];
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

/** Spec-shaped input for the canonical entrypoint. */
export interface GenerateOpenAIImageTryOnParams {
  /** Customer photo (base image). */
  userImage: File;
  /** One or more product reference images. The first is used as the
   *  primary product reference. */
  productImages: File[];
  /** Optional B/W mask (white = editable, black = preserved). */
  maskImage?: File | null;
  /** Optional pre-rendered composite (overrides userImage as base). */
  compositeImage?: File | null;
  category: CategoryId;
  /** Hand-jewelry subtype. */
  productSubtype?: HandJewelryType;
  /** Target finger for rings. */
  targetFinger?: FingerId;
  /** Optional override for the prompt (caller-built). */
  prompt?: string;
  /** Optional overrides for env defaults. */
  quality?: OpenAIEnv["quality"];
  size?: OpenAIEnv["size"];
  /** Free-form merchant notes appended to the prompt. */
  notes?: string;
}

export interface OpenAIImageMeta {
  maskUsed: boolean;
  productHasAlpha: boolean;
  baseImageCount: number;
  /** Whether a deterministic composite was used as the base image. */
  compositeUsedAsBase: boolean;
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

/**
 * Canonical entrypoint per the spec. Strict, no fallbacks.
 *  - Throws OpenAIConfigError if OPENAI_API_KEY is missing.
 *  - Throws MaskRequiredError if REQUIRE_MASK_FOR_OPENAI=true and no mask.
 *  - Throws MaskDimensionError if the mask doesn't match the base image.
 *  - Throws on any SDK / network error so the route can return an error
 *    JSON instead of silently rendering locally.
 */
export async function generateOpenAIImageTryOn(
  params: GenerateOpenAIImageTryOnParams
): Promise<GenerateOpenAIImageTryOnResult> {
  const env = readOpenAIEnv();
  if (!env.apiKey) {
    throw new OpenAIConfigError(
      "OPENAI_API_KEY is missing. Set it in your environment to use the OpenAI provider."
    );
  }

  const size = params.size ?? env.size;
  const quality = params.quality ?? env.quality;
  const targetSize =
    size === "auto" ? 1024 : Number(size.split("x")[0]) || 1024;

  // ── 1. Resolve base image (composite > user photo) ─────────────────
  const compositeUsedAsBase = Boolean(params.compositeImage);
  const primaryBuf = Buffer.from(
    await (params.compositeImage ?? params.userImage).arrayBuffer()
  );
  const primaryDims = await getDimensions(primaryBuf);

  // ── 2. Mask handling — validate dimensions BEFORE resizing ────────
  const useMaskedEdit = isMaskedEditEnabledFor(params.category);
  const haveRawMask = Boolean(params.maskImage);
  const willUseMask = haveRawMask && useMaskedEdit;

  if (env.requireMask && !haveRawMask) {
    throw new MaskRequiredError();
  }

  let alphaMask: Buffer | null = null;
  if (willUseMask && params.maskImage) {
    const rawMask = Buffer.from(await params.maskImage.arrayBuffer());
    const maskDims = await getDimensions(rawMask);
    if (
      maskDims.width !== primaryDims.width ||
      maskDims.height !== primaryDims.height
    ) {
      throw new MaskDimensionError(
        `Base ${primaryDims.width}x${primaryDims.height} vs mask ${maskDims.width}x${maskDims.height}.`
      );
    }
    const squaredMask = await squareForOpenAI(rawMask, targetSize);
    alphaMask = await bwMaskToAlphaPng(squaredMask);
  }

  // ── 3. Build base image array ─────────────────────────────────────
  const baseImages: Buffer[] = [];
  baseImages.push(await squareForOpenAI(primaryBuf, targetSize));

  // Pass the product as a second reference (gpt-image-1 multi-image
  // edit). When a composite is already present, the composite already
  // bakes the product in — but adding the clean product reference helps
  // the model recover details lost during warping/blending.
  let productHasAlpha = false;
  if (
    params.productImages.length > 0 &&
    env.model.includes("gpt-image")
  ) {
    const productBuf = Buffer.from(
      await params.productImages[0].arrayBuffer()
    );
    productHasAlpha = (await getDimensions(productBuf)).hasAlpha;
    baseImages.push(await squareForOpenAI(productBuf, targetSize));
  }

  // ── 4. Build prompt (or honour caller-provided override) ─────────
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
      `[try-on] productSubtype=${params.productSubtype ?? "n/a"} targetFinger=${
        params.targetFinger ?? "n/a"
      } size=${size} quality=${quality}`
  );

  // ── 5. Call OpenAI ───────────────────────────────────────────────
  const startedAt = Date.now();
  const { b64 } = await callOpenAIImageEdit({
    apiKey: env.apiKey,
    model: env.model,
    size,
    quality,
    prompt,
    baseImages,
    alphaMask,
  });
  const durationMs = Date.now() - startedAt;

  console.info(
    `[try-on] durationMs=${durationMs} provider=openai model=${env.model} category=${params.category}`
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
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Legacy adapter — TryOnRequest in, TryOnResponse out
// ──────────────────────────────────────────────────────────────────────────

export interface OpenAIImageParams extends TryOnRequest {
  inpaintComposite?: File;
  inpaintMask?: File;
}

export async function openaiTryOn(
  params: OpenAIImageParams
): Promise<TryOnResponse & { openaiMeta: OpenAIImageMeta }> {
  const result = await generateOpenAIImageTryOn({
    userImage: params.userImage,
    productImages: params.productImages,
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
      productImageCount: params.productImages.length,
    },
    openaiMeta: result.meta,
  };
}
