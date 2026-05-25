import type { CategoryId } from "@/types";

/**
 * Category-specific prompts used with FLUX Kontext multi-image edit.
 * The first image is always the user photo, the second(+) is the product.
 *
 * Each prompt is designed to:
 *   - Place the product naturally on the right body part
 *   - Preserve the user identity (face, skin, hair, body, background)
 *   - Match lighting, perspective and shadows
 *   - Include explicit negative guidance to avoid common failure modes
 */

interface PromptParams {
  count: number;
  notes?: string;
}

const NEGATIVES =
  "Do NOT add extra limbs. Do NOT duplicate the product. Do NOT distort the face. " +
  "Do NOT reshape the body. Do NOT change the background unless strictly necessary.";

const PROMPT_BUILDERS: Record<CategoryId, (p: PromptParams) => string> = {
  headwear: () =>
    "Place the cap/hat/beanie from the second image naturally on the head of the person " +
    "in the first image. Match scale, lighting, perspective and shadows precisely. " +
    "Preserve the face, hairline, skin tone, expression, body and background exactly. " +
    "Photorealistic e-commerce-quality result. " +
    NEGATIVES,

  glasses: () =>
    "Remove any existing glasses from the person in the first image, then place the new " +
    "eyewear from the second image, aligned with the eyes, the bridge of the nose and the " +
    "temples. Preserve face identity, skin, eye color, hair and background. " +
    "Avoid altering the facial structure. Photorealistic. " +
    NEGATIVES,

  watch: () =>
    "Place the watch from the second image on the wrist of the person in the first image. " +
    "Match the wrist angle, perspective, lighting, shadows and reflections. Keep the hand, " +
    "skin, arm and background completely unchanged. Avoid adding any extra accessory. " +
    "Photorealistic. " +
    NEGATIVES,

  "hand-jewelry": ({ count }) =>
    `Place the jewelry (ring, bracelet or hand piece) from the ${
      count > 2 ? "additional images" : "second image"
    } on the hand of the person in the first image, fitted naturally on the appropriate ` +
    "finger or wrist. If several pieces are provided, compose them tastefully without " +
    "overcrowding. Preserve hand pose, skin tone, nails and background exactly. " +
    "Match lighting and shadows. Photorealistic. " +
    NEGATIVES,

  clothes: ({ count }) =>
    `Dress the person in the first image with the garment(s) from the ${
      count > 2 ? "other images" : "second image"
    }, fitted realistically to their body shape, pose and posture. Preserve identity, ` +
    "face, hair, skin, body proportions and background. Preserve garment color, fabric, " +
    "logos and patterns exactly. Match the original lighting for a clean realistic " +
    "e-commerce try-on result. " +
    NEGATIVES,
};

export function buildPrompt(
  category: CategoryId,
  totalImageCount: number,
  notes?: string
): string {
  const base = PROMPT_BUILDERS[category]({ count: totalImageCount, notes });
  if (notes && notes.trim()) {
    return `${base} Additional instructions: ${notes.trim()}`;
  }
  return base;
}
