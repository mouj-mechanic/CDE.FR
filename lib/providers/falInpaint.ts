import { fal } from "@fal-ai/client";
import type { TryOnRequest, TryOnResponse } from "@/types";
import { buildInpaintPrompt } from "./prompts";

/**
 * Server-side inpainting refinement for the watch try-on.
 *
 *  Input:
 *    - composite : deterministic preview (warped watch on wrist, client-side)
 *    - mask      : 1:1 PNG, black background + white watch silhouette with
 *                  20-px Gaussian feather bleeding onto the skin (grey ramp
 *                  = AO blending zone)
 *
 *  Primary model: `fal-ai/flux-lora/inpainting`
 *    - Accepts `strength` (0.30) — the key lever for painting contact
 *      shadows in the feathered grey zone while keeping dial details at
 *      ~30 % denoise inside the white silhouette.
 *    - `flux-pro/v1/fill` was demoted: it ignores `strength` and often
 *      leaves a flat sticker look on wrist try-ons.
 *
 *  Fallback chain:
 *    1. fal-ai/flux-lora/inpainting  (strength-aware, primary)
 *    2. fal-ai/flux-pro/v1/fill      (no strength, mask-only scaling)
 *    3. fal-ai/sdxl-inpainting       (last resort)
 */

/** Primary — strength-aware; best for soft-mask AO on skin. */
export const FAL_INPAINT_PRIMARY_MODEL = "fal-ai/flux-lora/inpainting";

export const FAL_INPAINT_FALLBACK_MODELS = [
  "fal-ai/flux-pro/v1/fill",
  "fal-ai/sdxl-inpainting",
] as const;

interface FalInpaintOutput {
  images?: Array<{ url?: string }>;
  image?: { url?: string };
  output?: string | { url?: string };
  seed?: number;
}

interface FalQueueLog {
  message?: string;
}
interface FalQueueUpdate {
  status?: string;
  logs?: FalQueueLog[];
}

function pickResultUrl(data: FalInpaintOutput): string | null {
  const candidates: Array<string | undefined> = [
    data.images?.[0]?.url,
    data.image?.url,
    typeof data.output === "string"
      ? data.output
      : data.output && typeof data.output === "object"
        ? data.output.url
        : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

async function uploadFile(file: File): Promise<string> {
  return await fal.storage.upload(file);
}

interface InpaintModelInput {
  prompt: string;
  composite: string;
  mask: string;
}

/**
 * Shared inpainting parameters.
 *
 *  `strength: 0.30` — global denoise cap multiplied by per-pixel mask value:
 *    white (dial interior)  → ~0.30 → logos / hands preserved
 *    grey (feather band)    → ~0.05–0.20 → contact shadows on skin
 *    black (outside watch)  → 0 → untouched skin
 */
const INPAINT_PARAMS = {
  num_inference_steps: 40,
  guidance_scale: 3.5,
  strength: 0.3,
} as const;

const FLUX_LORA_MODEL = "fal-ai/flux-lora/inpainting";
const FLUX_FILL_MODEL = "fal-ai/flux-pro/v1/fill";
const SDXL_INPAINT_MODEL = "fal-ai/sdxl-inpainting";

function buildModelInput(
  modelId: string,
  { prompt, composite, mask }: InpaintModelInput
): Record<string, unknown> {
  if (modelId === FLUX_LORA_MODEL) {
    return {
      prompt,
      image_url: composite,
      mask_url: mask,
      num_inference_steps: INPAINT_PARAMS.num_inference_steps,
      guidance_scale: INPAINT_PARAMS.guidance_scale,
      strength: INPAINT_PARAMS.strength,
      output_format: "jpeg",
    };
  }
  if (modelId === FLUX_FILL_MODEL) {
    // No `strength` — mask grey ramp provides per-pixel scaling only.
    return {
      prompt,
      image_url: composite,
      mask_url: mask,
      num_inference_steps: INPAINT_PARAMS.num_inference_steps,
      guidance_scale: INPAINT_PARAMS.guidance_scale,
      safety_tolerance: "2",
      output_format: "jpeg",
    };
  }
  // SDXL inpainting — last resort.
  return {
    prompt,
    image_url: composite,
    mask_url: mask,
    num_inference_steps: INPAINT_PARAMS.num_inference_steps,
    guidance_scale: INPAINT_PARAMS.guidance_scale,
    strength: INPAINT_PARAMS.strength,
  };
}

async function callModel(
  modelId: string,
  input: Record<string, unknown>
): Promise<string> {
  const res = await fal.subscribe(modelId, {
    input,
    logs: true,
    onQueueUpdate: (u: FalQueueUpdate) => {
      if (u.status === "IN_PROGRESS" && Array.isArray(u.logs)) {
        for (const log of u.logs) {
          if (log?.message) console.log("[fal-inpaint]", log.message);
        }
      }
    },
  });
  const url = pickResultUrl(res.data as FalInpaintOutput);
  if (!url) throw new Error(`${modelId} returned no image URL.`);
  return url;
}

export interface InpaintParams extends TryOnRequest {
  inpaintComposite: File;
  inpaintMask: File;
}

export async function falInpaintTryOn(
  params: InpaintParams,
  apiKey: string
): Promise<TryOnResponse> {
  fal.config({ credentials: apiKey });

  const [compositeUrl, maskUrl] = await Promise.all([
    uploadFile(params.inpaintComposite),
    uploadFile(params.inpaintMask),
  ]);

  const prompt = buildInpaintPrompt(params.category, params.notes);

  console.info(
    `[fal-inpaint] start category=${params.category} primary=${FAL_INPAINT_PRIMARY_MODEL} strength=${INPAINT_PARAMS.strength}`
  );

  const candidates = [
    FAL_INPAINT_PRIMARY_MODEL,
    ...FAL_INPAINT_FALLBACK_MODELS,
  ];

  let lastErr: unknown = null;
  for (const modelId of candidates) {
    try {
      const input = buildModelInput(modelId, {
        prompt,
        composite: compositeUrl,
        mask: maskUrl,
      });
      console.info(`[fal-inpaint] subscribing model=${modelId}`);
      const resultUrl = await callModel(modelId, input);
      if (resultUrl === compositeUrl) {
        throw new Error(
          `${modelId} returned the composite URL unchanged — treating as failed.`
        );
      }
      console.info(`[fal-inpaint] success model=${modelId}`);
      return {
        resultUrl,
        generatedAt: Date.now(),
        mock: false,
        provider: "fal",
        model: modelId,
        category: params.category,
        debug: {
          imageCount: 2,
          productImageCount: 1,
        },
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[fal-inpaint] model=${modelId} failed: ${msg}`);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("All fal inpainting models failed.");
}
