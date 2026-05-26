import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { TryOnRequest, TryOnResponse } from "@/types";
import { buildOpenAIPrompt } from "./prompts";

/**
 * OpenAI GPT Image provider.
 *
 *  Endpoint: `client.images.edit({ model, image, mask, prompt, n, size })`
 *
 *  ─── Differences vs fal.ai inpainting ────────────────────────────────────
 *  • Mask format: alpha-channel PNG (transparent = editable, opaque = preserved).
 *    Our pipeline produces a B&W mask (white = editable, black = preserved) —
 *    we convert it server-side with `sharp` before calling the SDK.
 *  • Multi-image input: `gpt-image-1` accepts an array of up to 16 images
 *    via the `image` field. We pass the user/composite as the base + the
 *    transparent product PNG as a reference, and the prompt anchors them.
 *  • Output: `b64_json` by default. We return a `data:` URL that the
 *    frontend already knows how to render. If you'd prefer a hosted URL,
 *    swap the return path with an upload to your CDN.
 *
 *  ─── Security ────────────────────────────────────────────────────────────
 *  - Reads OPENAI_API_KEY from process.env.
 *  - Never logs the key, never returns it in error messages.
 *  - Caller is the API route; the key never reaches the browser.
 */

export const OPENAI_DEFAULT_MODEL = "gpt-image-1";
const OPENAI_DEFAULT_SIZE = "1024x1024";
const OPENAI_DEFAULT_QUALITY = "high";

/** Tunable parameters resolved from env at call time. */
function readOpenAIEnv() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model =
    process.env.OPENAI_IMAGE_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
  const size =
    (process.env.OPENAI_IMAGE_SIZE?.trim() as
      | "1024x1024"
      | "1024x1536"
      | "1536x1024"
      | "auto"
      | undefined) || OPENAI_DEFAULT_SIZE;
  const quality =
    (process.env.OPENAI_IMAGE_QUALITY?.trim() as
      | "low"
      | "medium"
      | "high"
      | "auto"
      | undefined) || OPENAI_DEFAULT_QUALITY;
  const useMaskedEdit =
    (process.env.OPENAI_USE_MASKED_EDIT?.trim().toLowerCase() ?? "true") !==
    "false";
  return { apiKey, model, size, quality, useMaskedEdit };
}

/**
 * Convert our pipeline B&W mask (white = editable, black = preserved) into
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
    // R = G = B = 0 (mask colour is irrelevant). Alpha is the inverse of
    // the grayscale value (R channel suffices since input is grayscale).
    rgba[dst] = 0;
    rgba[dst + 1] = 0;
    rgba[dst + 2] = 0;
    rgba[dst + 3] = 255 - data[src];
  }

  return await sharp(rgba, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * Resize an image to fit OpenAI's preferred size while keeping aspect.
 * We use `cover` so the wrist stays centred (the watch case is the most
 * sensitive — a center-crop preserves the relevant area).
 */
async function squareForOpenAI(
  src: Buffer,
  targetSize: number
): Promise<Buffer> {
  return await sharp(src)
    .resize(targetSize, targetSize, {
      fit: "cover",
      position: "center",
    })
    .png()
    .toBuffer();
}

interface ImageEditCallOptions {
  apiKey: string;
  model: string;
  size: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  quality: "low" | "medium" | "high" | "auto";
  prompt: string;
  /** Base image(s). For gpt-image-1 may be a single PNG or an array. */
  baseImages: Buffer[];
  /** Optional alpha-channel mask, must match base[0] dimensions. */
  alphaMask: Buffer | null;
}

/** Wraps the SDK call with structured logs and a typed return. */
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

  // gpt-image-1 accepts both a single file and a File[]; older models like
  // dall-e-2 only accept a single file. We pass an array for gpt-image-1
  // and unwrap when there's only one.
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
  // `quality` is only honoured by gpt-image-* — including it on older
  // models would error out.
  if (opts.model.includes("gpt-image")) {
    editParams.quality = opts.quality;
  }
  if (maskFile) {
    editParams.mask = maskFile;
  }

  // The SDK's typing for `images.edit` is generic; cast through unknown so
  // we keep our explicit param shape without fighting overloaded variants.
  const res = (await client.images.edit(
    editParams as unknown as Parameters<typeof client.images.edit>[0]
  )) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const first = res.data?.[0];
  if (!first) throw new Error("OpenAI image edit returned no result.");

  if (first.b64_json) return { b64: first.b64_json };

  // Fallback for endpoints that return URLs (older models).
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

export interface OpenAIImageParams extends TryOnRequest {
  /**
   * Optional pre-rendered composite (deterministic preview produced
   * client-side). When present, used as the base instead of the raw user
   * photo so OpenAI only refines blending/shadows.
   */
  inpaintComposite?: File;
  /** Optional B&W contact-band mask (same dimensions as composite). */
  inpaintMask?: File;
}

export interface OpenAIImageMeta {
  maskUsed: boolean;
  productHasAlpha: boolean;
  baseImageCount: number;
}

export async function openaiTryOn(
  params: OpenAIImageParams
): Promise<TryOnResponse & { openaiMeta: OpenAIImageMeta }> {
  const env = readOpenAIEnv();
  if (!env.apiKey) {
    throw new Error(
      "OPENAI_API_KEY is missing. Set it in your environment to use the OpenAI provider."
    );
  }

  const targetSize =
    env.size === "auto" ? 1024 : Number(env.size.split("x")[0]) || 1024;

  // ── Build base image(s) ────────────────────────────────────────────
  // Priority 1 : the deterministic composite (already has the watch placed).
  // Priority 2 : the raw user photo + the transparent product as a second
  //              reference image (multi-image edit).
  const baseImages: Buffer[] = [];
  let primaryBuf: Buffer;

  if (params.inpaintComposite) {
    primaryBuf = Buffer.from(await params.inpaintComposite.arrayBuffer());
  } else {
    primaryBuf = Buffer.from(await params.userImage.arrayBuffer());
  }
  baseImages.push(await squareForOpenAI(primaryBuf, targetSize));

  // Add the product image as a second reference (gpt-image-1 only).
  if (
    !params.inpaintComposite &&
    params.productImages.length > 0 &&
    env.model.includes("gpt-image")
  ) {
    const productBuf = Buffer.from(
      await params.productImages[0].arrayBuffer()
    );
    baseImages.push(await squareForOpenAI(productBuf, targetSize));
  }

  // ── Build alpha mask (if any + feature flag on) ────────────────────
  let alphaMask: Buffer | null = null;
  if (env.useMaskedEdit && params.inpaintMask) {
    const rawMask = Buffer.from(await params.inpaintMask.arrayBuffer());
    // The mask must match the *primary* base image exactly.
    const squaredMask = await squareForOpenAI(rawMask, targetSize);
    alphaMask = await bwMaskToAlphaPng(squaredMask);
  }

  // Detect alpha on the product image (debug only — does not change behaviour).
  let productHasAlpha = false;
  if (params.productImages[0]) {
    try {
      const meta = await sharp(
        Buffer.from(await params.productImages[0].arrayBuffer())
      ).metadata();
      productHasAlpha = Boolean(meta.hasAlpha);
    } catch {
      productHasAlpha = false;
    }
  }

  const prompt = buildOpenAIPrompt(params.category, {
    hasMask: Boolean(alphaMask),
    notes: params.notes,
  });

  console.info(
    `[openai-image] start category=${params.category} model=${env.model} size=${env.size} quality=${env.quality} maskUsed=${Boolean(alphaMask)} baseImages=${baseImages.length} productHasAlpha=${productHasAlpha}`
  );

  const startedAt = Date.now();
  const { b64 } = await callOpenAIImageEdit({
    apiKey: env.apiKey,
    model: env.model,
    size: env.size,
    quality: env.quality,
    prompt,
    baseImages,
    alphaMask,
  });
  const durationMs = Date.now() - startedAt;
  console.info(
    `[openai-image] success category=${params.category} durationMs=${durationMs}`
  );

  // Return as a data URL so the frontend can render directly.
  const resultUrl = `data:image/png;base64,${b64}`;

  return {
    resultUrl,
    generatedAt: Date.now(),
    mock: false,
    provider: "openai",
    model: env.model,
    category: params.category,
    debug: {
      imageCount: baseImages.length + (alphaMask ? 1 : 0),
      productImageCount: params.productImages.length,
    },
    openaiMeta: {
      maskUsed: Boolean(alphaMask),
      productHasAlpha,
      baseImageCount: baseImages.length,
    },
  };
}
