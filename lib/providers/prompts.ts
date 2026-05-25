import type { CategoryId } from "@/types";

/**
 * Category-specific prompts for FLUX Kontext multi-image edit
 * (`fal-ai/flux-pro/kontext/max/multi`).
 *
 * Convention enforced by every prompt:
 *   - image 1 = the CUSTOMER photo (the person to keep)
 *   - image 2 = the EXACT product reference (the item to add)
 *   - additional images (>2) = extra product references when relevant
 *
 * The prompts must be explicit and directive to prevent FLUX from returning
 * the original photo unchanged — a known failure mode when the instruction
 * is too soft. Always include:
 *   - "Use image 1 as the customer photo."
 *   - "Use image 2 as the exact product reference."
 *   - "Do not return the original image unchanged."
 */

const GLOBAL_NEGATIVES =
  "Do NOT return the original image unchanged. Do NOT add extra limbs. " +
  "Do NOT duplicate the product. Do NOT distort the face or body proportions. " +
  "Do NOT change the background unless strictly necessary.";

interface PromptParams {
  count: number;
  notes?: string;
}

const PROMPT_BUILDERS: Record<CategoryId, (p: PromptParams) => string> = {
  headwear: () =>
    "Use image 1 as the customer photo. Use image 2 as the exact headwear " +
    "product reference. Place the cap, hat, or beanie from image 2 naturally " +
    "on the person's head in image 1. It must be clearly visible. Match head " +
    "angle, scale, lighting, and shadows. Preserve the face, expression, and " +
    "background. " +
    GLOBAL_NEGATIVES,

  glasses: () =>
    "Use image 1 as the customer photo. Use image 2 as the exact glasses " +
    "frame reference. Place the glasses from image 2 onto the face in image 1, " +
    "aligned with the eyes, nose bridge, and temples. The glasses must be " +
    "clearly visible. Remove any existing glasses in image 1 first. Preserve " +
    "the face identity, expression, skin tone, and background. " +
    GLOBAL_NEGATIVES,

  watch: () =>
    "Use image 1 as the customer photo. Use image 2 as the exact product " +
    "reference. Add the watch from image 2 onto the visible wrist in image 1. " +
    "The watch must be clearly visible on the wrist. Match the wrist angle, " +
    "scale, perspective, shadows, and lighting. Preserve the original hand, " +
    "skin tone, background, and pose. Do not add extra watches. Do not change " +
    "the person's identity or background. " +
    GLOBAL_NEGATIVES,

  "hand-jewelry": () =>
    "Use image 1 as the customer photo. Use image 2 as the exact jewelry " +
    "product reference. Place the ring, bracelet, or hand jewelry from image 2 " +
    "naturally on the appropriate finger, hand, or wrist in image 1. The " +
    "jewelry must be clearly visible. Preserve hand pose, skin tone, nails, " +
    "lighting, and background. " +
    GLOBAL_NEGATIVES,

  clothes: () =>
    "Use image 1 as the customer photo. Use image 2 as the exact clothing " +
    "product reference. Dress the person in image 1 with the clothing item " +
    "from image 2. Preserve identity, face, body proportions, pose, lighting, " +
    "and background. Preserve garment color, fabric, texture, pattern, and " +
    "logos as much as possible. The clothing must be clearly visible. " +
    GLOBAL_NEGATIVES,
};

export function buildPrompt(
  category: CategoryId,
  totalImageCount: number,
  notes?: string
): string {
  const base = PROMPT_BUILDERS[category]({
    count: totalImageCount,
    notes,
  });
  if (notes && notes.trim()) {
    return `${base} Additional context from the user: ${notes.trim()}`;
  }
  return base;
}
