import { fal } from "@fal-ai/client";

/**
 * Server-side background-removal provider that turns a product photo into
 * a transparent PNG cutout — a prerequisite for clean compositing in the
 * fast overlay pipeline and for high-quality AI refinement.
 *
 *  Primary model : fal-ai/bria/background/remove  (best quality)
 *  Fallback      : fal-ai/imageutils/rembg
 *
 * Security:
 *  - Reads FAL_KEY from process.env only.
 *  - Never logs or returns the key.
 *  - Never accepts a key from the request.
 */

export const BRIA_REMOVE_MODEL = "fal-ai/bria/background/remove";
export const REMBG_MODEL = "fal-ai/imageutils/rembg";

interface BgRemoveOutput {
  image?: { url?: string };
  images?: Array<{ url?: string }>;
  output?: { url?: string } | string;
  result?: { url?: string };
  // Some models echo the field they accept (e.g. "image" or "image_url")
  image_url?: string;
}

interface RemoveInput {
  file?: File;
  imageUrl?: string;
}

interface RemoveResult {
  cutoutUrl: string;
  provider: "fal";
  model: string;
}

function readFalKey(): string {
  const key =
    process.env.FAL_KEY?.trim() || process.env.AI_TRYON_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "FAL_KEY is missing. Background removal requires a fal.ai key."
    );
  }
  return key;
}

function pickCutoutUrl(data: BgRemoveOutput): string | null {
  const candidates: Array<string | undefined> = [
    data.image?.url,
    data.images?.[0]?.url,
    data.image_url,
    data.result?.url,
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

async function ensureUploadedUrl(input: RemoveInput): Promise<string> {
  if (input.imageUrl && input.imageUrl.startsWith("http")) return input.imageUrl;
  if (input.file) return await fal.storage.upload(input.file);
  throw new Error("No product image provided for background removal.");
}

async function tryModel(modelId: string, imageUrl: string): Promise<string> {
  const result = await fal.subscribe(modelId, {
    input: {
      // Most fal background-removal models accept either `image_url` or
      // `image`. We pass both to maximize compatibility.
      image_url: imageUrl,
      image: imageUrl,
    },
    logs: false,
  });
  const data = result.data as BgRemoveOutput;
  const url = pickCutoutUrl(data);
  if (!url) {
    throw new Error(`${modelId} returned no cutout URL.`);
  }
  return url;
}

/**
 * Remove the background from a product photo. Returns a fal.media URL
 * pointing to the transparent PNG cutout.
 */
export async function removeProductBackground(
  input: RemoveInput
): Promise<RemoveResult> {
  const apiKey = readFalKey();
  fal.config({ credentials: apiKey });

  const imageUrl = await ensureUploadedUrl(input);

  console.info(
    `[bg-remove] starting model=${BRIA_REMOVE_MODEL} source=${input.file ? "file" : "url"}`
  );

  try {
    const cutoutUrl = await tryModel(BRIA_REMOVE_MODEL, imageUrl);
    console.info(`[bg-remove] success model=${BRIA_REMOVE_MODEL}`);
    return { cutoutUrl, provider: "fal", model: BRIA_REMOVE_MODEL };
  } catch (primaryErr) {
    const msg =
      primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    console.warn(
      `[bg-remove] primary failed (${BRIA_REMOVE_MODEL}): ${msg} — trying fallback ${REMBG_MODEL}`
    );
    try {
      const cutoutUrl = await tryModel(REMBG_MODEL, imageUrl);
      console.info(`[bg-remove] success model=${REMBG_MODEL}`);
      return { cutoutUrl, provider: "fal", model: REMBG_MODEL };
    } catch (fallbackErr) {
      const fbMsg =
        fallbackErr instanceof Error
          ? fallbackErr.message
          : String(fallbackErr);
      console.error(
        `[bg-remove] fallback failed (${REMBG_MODEL}): ${fbMsg}`
      );
      throw new Error(
        "Le détourage du produit a échoué. Essayez une autre image produit."
      );
    }
  }
}
