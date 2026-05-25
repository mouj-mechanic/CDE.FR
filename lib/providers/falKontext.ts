import { fal } from "@fal-ai/client";
import type { TryOnRequest, TryOnResponse } from "@/types";
import { buildPrompt } from "./prompts";

export const FAL_KONTEXT_MODEL = "fal-ai/flux-pro/kontext/max/multi";

interface FalKontextOutput {
  images: Array<{ url: string; width?: number; height?: number }>;
  seed?: number;
}

async function fileToUploadedUrl(file: File): Promise<string> {
  return await fal.storage.upload(file);
}

/**
 * Generic accessory try-on via FLUX.1 Kontext multi-image edit.
 * Used for headwear, glasses, watch and hand-jewelry. Can also handle
 * clothing as a fallback when FASHN is not configured.
 */
export async function falKontextTryOn(
  params: TryOnRequest,
  apiKey: string
): Promise<TryOnResponse> {
  fal.config({ credentials: apiKey });

  const userImageUrl = await fileToUploadedUrl(params.userImage);

  const productImageUrls = await Promise.all(
    params.productImages.map((file) => fileToUploadedUrl(file))
  );

  const allProductUrls = [...productImageUrls, ...params.productUrls];
  if (allProductUrls.length === 0) {
    throw new Error("Aucune image produit fournie.");
  }

  const imageUrls = [userImageUrl, ...allProductUrls];
  const prompt = buildPrompt(params.category, imageUrls.length, params.notes);

  const result = await fal.subscribe(FAL_KONTEXT_MODEL, {
    input: {
      prompt,
      image_urls: imageUrls,
      guidance_scale: 3.5,
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "2",
    },
    logs: false,
  });

  const data = result.data as FalKontextOutput;
  const firstImage = data?.images?.[0];
  if (!firstImage?.url) {
    throw new Error("FLUX Kontext n'a pas retourné d'image.");
  }

  return {
    resultUrl: firstImage.url,
    generatedAt: Date.now(),
    mock: false,
    provider: "fal",
    model: FAL_KONTEXT_MODEL,
    category: params.category,
  };
}
