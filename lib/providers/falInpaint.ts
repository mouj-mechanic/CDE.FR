import { fal } from "@fal-ai/client";
import type { TryOnRequest, TryOnResponse } from "@/types";
import { buildInpaintPrompt } from "./prompts";

/**
 * Server-side FLUX-based inpainting refinement for the watch try-on.
 *
 *  Input:
 *    - composite : the deterministic preview (user photo with the warped
 *                  watch already placed, generated on the client by
 *                  `renderWatchOverlay`).
 *    - mask      : a 1:1 black + white PNG. White pixels = the contour
 *                  band the AI is allowed to repaint (~8–14 px ring around
 *                  the watch silhouette). Black pixels are preserved
 *                  exactly by the model.
 *
 *  Output:
 *    - resultUrl : fal CDN URL of the refined image.
 *
 *  Why FLUX.1 [pro] Fill?
 *    - Production-grade inpainting that *guarantees* pixel-perfect
 *      preservation of black-masked areas. The dial of the watch is
 *      mathematically impossible to alter as long as it falls outside the
 *      mask, removing the dial-hallucination risk that pure prompt-based
 *      try-on models (e.g. FLUX Kontext) suffer from.
 *    - Excellent at adding contact shadows, lighting blend, and
 *      photorealistic skin tone matching at the seams.
 *
 *  Fallback: if the primary endpoint fails (capacity, model deprecation,
 *  geo issues), the function tries `fal-ai/flux-lora/inpainting` then
 *  finally `fal-ai/sdxl-inpainting`.
 *
 *  Security:
 *    - Reads FAL_KEY from process.env.
 *    - Never echoes the key into logs or errors.
 */

export const FAL_INPAINT_PRIMARY_MODEL = "fal-ai/flux-pro/v1/fill";
export const FAL_INPAINT_FALLBACK_MODELS = [
  "fal-ai/flux-lora/inpainting",
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
 * Common inpainting parameters used across all candidate models.
 *
 *  - `num_inference_steps: 40` — high enough to converge a clean ramp of
 *    contact shadows in the feathered mask zone without exploding cost.
 *  - `guidance_scale: 3.5` — sweet spot for SDXL-style inpainters; light
 *    prompt adherence keeps the watch geometry from being re-imagined.
 *  - `strength: 0.28` — applied to every model as a per-pixel denoise
 *    multiplier on top of the mask values. With our soft mask (white
 *    silhouette + 15-20 px Gaussian feather), this gives:
 *       inside the dial      → ~0.28 effective denoise → details preserved
 *       contour (mid grey)   → ~0.14 → micro-AO shadows
 *       outside the watch    → 0 → pixel-perfect skin
 *    NOTE: `fal-ai/flux-pro/v1/fill` does **not** accept `strength`.
 *    We therefore omit it for that endpoint and rely entirely on the
 *    soft mask for the AO ramp.
 */
const INPAINT_PARAMS = {
  num_inference_steps: 40,
  guidance_scale: 3.5,
  strength: 0.28,
} as const;

function buildModelInput(
  modelId: string,
  { prompt, composite, mask }: InpaintModelInput
): Record<string, unknown> {
  // The three models we route to all accept slightly different schemas.
  // We keep them close enough to share the same composite+mask URLs.
  if (modelId === FAL_INPAINT_PRIMARY_MODEL) {
    // FLUX.1 [pro] Fill — official inpainting endpoint.
    // No `strength` here: the endpoint does not expose it. The soft
    // mask alone provides per-pixel denoise scaling.
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
  if (modelId === "fal-ai/flux-lora/inpainting") {
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
  // SDXL inpainting — last-resort fallback.
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
  /** Composite preview (user photo with the warped watch already placed). */
  inpaintComposite: File;
  /** 1:1 black + white contact-band mask. */
  inpaintMask: File;
}

/**
 * Run the inpainting refinement.
 *
 *  Returns a {@link TryOnResponse} with `provider: "fal"` and the fal model
 *  that actually produced the result.
 */
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
    `[fal-inpaint] start category=${params.category} compositeUploaded maskUploaded`
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
        // Some fal models echo the input back on no-op; treat as failure so
        // we fall through to the next candidate.
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
          imageCount: 2, // composite + mask
          productImageCount: 1,
        },
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[fal-inpaint] model=${modelId} failed: ${msg}`);
      // Move to next candidate.
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("All fal inpainting models failed.");
}
