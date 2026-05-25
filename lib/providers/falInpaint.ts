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

function buildModelInput(
  modelId: string,
  { prompt, composite, mask }: InpaintModelInput
): Record<string, unknown> {
  // The three models we route to all accept slightly different schemas.
  // We keep them close enough to share the same composite+mask URLs.
  if (modelId === FAL_INPAINT_PRIMARY_MODEL) {
    // FLUX.1 [pro] Fill — official inpainting endpoint.
    return {
      prompt,
      image_url: composite,
      mask_url: mask,
      num_inference_steps: 32,
      guidance_scale: 30,
      safety_tolerance: "2",
      output_format: "jpeg",
      // No `strength` here: FLUX Fill always preserves unmasked pixels
      // exactly, so a tiny edge band already gives us the "low-denoise"
      // behaviour we want without hallucinating the dial.
    };
  }
  if (modelId === "fal-ai/flux-lora/inpainting") {
    return {
      prompt,
      image_url: composite,
      mask_url: mask,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      // SDXL-style strength control on the LoRA endpoint.
      strength: 0.28,
      output_format: "jpeg",
    };
  }
  // SDXL inpainting — last-resort.
  return {
    prompt,
    image_url: composite,
    mask_url: mask,
    num_inference_steps: 30,
    guidance_scale: 7.5,
    strength: 0.28,
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
