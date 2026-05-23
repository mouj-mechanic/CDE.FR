import { fal } from "@fal-ai/client";
import type { CategoryId, TryOnRequest, TryOnResponse } from "@/types";

const MODEL_ID = "fal-ai/flux-pro/kontext/max/multi";
// Modèle alternatif moins coûteux : "fal-ai/flux-pro/kontext/multi"

interface FalKontextOutput {
  images: Array<{ url: string; width?: number; height?: number }>;
  seed?: number;
}

const PROMPTS: Record<CategoryId, (count: number) => string> = {
  headwear: () =>
    "Place the hat/cap/beanie from the second image naturally on the head of the person from the first image. " +
    "Match the lighting, perspective and shadows precisely. Keep the person's face, hair, body, expression and background completely unchanged. " +
    "Photorealistic result, no other modifications.",
  glasses: () =>
    "Place the glasses/eyewear from the second image on the face of the person from the first image, aligned correctly with their eyes and ears. " +
    "Match lighting, reflections and skin tones. Remove any existing glasses. Keep the person's face, hair and background unchanged. " +
    "Photorealistic result.",
  watch: () =>
    "Place the watch from the second image on the wrist of the person from the first image, matching the angle, lighting and shadows naturally. " +
    "Keep the person's hand, arm, skin and background completely unchanged. Photorealistic.",
  "hand-jewelry": (count) =>
    `Place the jewelry (ring, bracelet or hand piece) from the ${count > 2 ? "additional images" : "second image"} on the hand of the person from the first image, fitted naturally on the appropriate finger or wrist. ` +
    "Match lighting and shadows. Keep the person's hand, skin tone and background unchanged. Photorealistic.",
  clothes: (count) =>
    `Dress the person from the first image with the clothing item(s) from the ${count > 2 ? "other images" : "second image"}, fitted realistically to their body shape and pose. ` +
    "Preserve the person's face, hair, skin, posture and background. Match the original lighting. " +
    "Photorealistic, high quality, natural fit.",
};

function buildPrompt(category: CategoryId, totalImageCount: number, notes?: string): string {
  const base = PROMPTS[category](totalImageCount);
  if (notes && notes.trim()) {
    return `${base} Additional instructions: ${notes.trim()}`;
  }
  return base;
}

async function fileToUploadedUrl(file: File): Promise<string> {
  return await fal.storage.upload(file);
}

export async function falTryOn(
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

  const prompt = buildPrompt(
    params.category,
    imageUrls.length,
    params.notes
  );

  const result = await fal.subscribe(MODEL_ID, {
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
    throw new Error("Le provider IA n'a pas retourné d'image.");
  }

  return {
    resultUrl: firstImage.url,
    generatedAt: Date.now(),
    mock: false,
  };
}
