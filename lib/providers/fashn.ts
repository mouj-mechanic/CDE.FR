import { fal } from "@fal-ai/client";
import type { TryOnRequest, TryOnResponse } from "@/types";

/**
 * FASHN virtual try-on (clothes specialist) — invoked through fal.
 *
 * This routes to a clothing-specialist model designed specifically for
 * realistic garment try-on (preserves identity, body, fabric, etc.). For
 * categories where FLUX Kontext gives weaker garment fidelity, FASHN should
 * give noticeably better results.
 *
 * Model id (subject to fal availability):
 *   - fashn/tryon/v1.6   — primary
 *   - fal-ai/fashn/tryon — fallback alias on some fal accounts
 *
 * Required inputs:
 *   - model_image:  the person photo URL
 *   - garment_image: the garment URL (single, primary product image)
 *
 * If the call fails, the caller is expected to fall back to FLUX Kontext.
 */

const FASHN_MODEL_IDS = [
  "fal-ai/fashn/tryon/v1.6",
  "fashn/tryon/v1.6",
  "fal-ai/fashn/tryon",
];

interface FashnOutput {
  // The fashn output can come back under different keys depending on the
  // wrapper. We try both `images[0].url` and `image_url` to be lenient.
  images?: Array<{ url?: string }>;
  image_url?: string;
}

async function fileToUploadedUrl(file: File): Promise<string> {
  return await fal.storage.upload(file);
}

export async function fashnTryOn(
  params: TryOnRequest,
  apiKey: string
): Promise<TryOnResponse> {
  fal.config({ credentials: apiKey });

  const userImageUrl = await fileToUploadedUrl(params.userImage);

  // Pick a single garment image — FASHN's try-on is single-garment per call.
  const productImageUrls = await Promise.all(
    params.productImages.map((file) => fileToUploadedUrl(file))
  );
  const firstGarment =
    productImageUrls[0] ?? params.productUrls[0];

  if (!firstGarment) {
    throw new Error("Aucune image de vêtement fournie pour FASHN.");
  }

  let lastError: unknown = null;
  for (const modelId of FASHN_MODEL_IDS) {
    try {
      const result = await fal.subscribe(modelId, {
        input: {
          model_image: userImageUrl,
          garment_image: firstGarment,
          // Optional extras supported by some FASHN variants
          category: "auto",
        },
        logs: false,
      });

      const data = result.data as FashnOutput;
      const url = data?.images?.[0]?.url || data?.image_url;
      if (url) {
        return {
          resultUrl: url,
          generatedAt: Date.now(),
          mock: false,
          provider: "fal",
          model: modelId,
          category: params.category,
        };
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("FASHN n'a pas retourné d'image.");
}
