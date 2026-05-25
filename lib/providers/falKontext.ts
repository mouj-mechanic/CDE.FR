import { fal } from "@fal-ai/client";
import type { TryOnRequest, TryOnResponse } from "@/types";
import { buildPrompt } from "./prompts";

export const FAL_KONTEXT_MODEL = "fal-ai/flux-pro/kontext/max/multi";

interface FalKontextImage {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

interface FalKontextOutput {
  images: FalKontextImage[];
  seed?: number;
}

interface FalQueueLog {
  message?: string;
}
interface FalQueueUpdate {
  status?: string;
  logs?: FalQueueLog[];
}

async function fileToUploadedUrl(file: File): Promise<string> {
  return await fal.storage.upload(file);
}

/**
 * Generic accessory try-on via FLUX.1 Kontext multi-image edit.
 * Used for headwear, glasses, watch, hand-jewelry — and as the fallback
 * for clothes when the FASHN call fails.
 *
 * Inputs to the model:
 *   - prompt: string                  (explicit "image 1 / image 2" framing)
 *   - image_urls: string[]            (user photo first, then product images)
 *   - guidance_scale: 5               (high enough to enforce the edit)
 *   - enhance_prompt: true            (FLUX rewrites the prompt internally)
 *   - num_images: 1
 *   - output_format: "jpeg"
 *   - safety_tolerance: "2"
 *
 * Failure modes guarded against:
 *   - imageUrls.length < 2     → explicit error
 *   - empty `images` payload   → explicit error
 *   - result URL identical to the uploaded user photo URL → explicit error
 *     ("fal returned the original user image unchanged")
 */
export async function falKontextTryOn(
  params: TryOnRequest,
  apiKey: string
): Promise<TryOnResponse> {
  fal.config({ credentials: apiKey });

  const userPhotoUrl = await fileToUploadedUrl(params.userImage);

  const uploadedProductUrls = await Promise.all(
    params.productImages.map((file) => fileToUploadedUrl(file))
  );

  const productImageUrls = [...uploadedProductUrls, ...params.productUrls];
  if (productImageUrls.length === 0) {
    throw new Error(
      "Real AI generation requires one user photo and at least one product image."
    );
  }

  const imageUrls = [userPhotoUrl, ...productImageUrls];
  if (imageUrls.length < 2) {
    throw new Error(
      "Real AI generation requires one user photo and at least one product image."
    );
  }

  const prompt = buildPrompt(params.category, imageUrls.length, params.notes);

  console.info(
    `[fal-kontext] subscribing model=${FAL_KONTEXT_MODEL} category=${params.category} imageCount=${imageUrls.length} productImageCount=${productImageUrls.length}`
  );

  const result = await fal.subscribe(FAL_KONTEXT_MODEL, {
    input: {
      prompt,
      image_urls: imageUrls,
      num_images: 1,
      output_format: "jpeg",
      guidance_scale: 5,
      safety_tolerance: "2",
      enhance_prompt: true,
    },
    logs: true,
    onQueueUpdate: (update: FalQueueUpdate) => {
      if (update.status === "IN_PROGRESS" && Array.isArray(update.logs)) {
        for (const log of update.logs) {
          if (log?.message) {
            console.log("[fal]", log.message);
          }
        }
      }
    },
  });

  const data = result.data as FalKontextOutput;
  const firstImage = data?.images?.[0];
  if (!firstImage?.url) {
    throw new Error("fal.ai returned no image URL.");
  }

  if (firstImage.url === userPhotoUrl) {
    throw new Error("fal.ai returned the original user image unchanged.");
  }

  return {
    resultUrl: firstImage.url,
    generatedAt: Date.now(),
    mock: false,
    provider: "fal",
    model: FAL_KONTEXT_MODEL,
    category: params.category,
    debug: {
      imageCount: imageUrls.length,
      productImageCount: productImageUrls.length,
    },
  };
}
