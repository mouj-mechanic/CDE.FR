import type { CategoryId, FingerId, HandJewelryType } from "@/types";

/**
 * OpenAI GPT Image prompt builder.
 *
 *  Distinct from `lib/providers/prompts.ts` (which targets fal.ai's FLUX
 *  models) because:
 *    - GPT Image accepts multiple reference images via `image[]` and the
 *      prompt must explicitly anchor "base" vs "reference".
 *    - Mask convention is opposite (transparent = editable). The prompt
 *      reflects this when `maskUsed=true`.
 *    - Hand-jewelry has subtype-specific wording (ring vs bracelet) and
 *      can address a target finger.
 *
 *  All prompts share three guarantees:
 *    1. Identity / anatomy / background preservation are restated
 *       explicitly to limit hallucinations.
 *    2. Sticker-style overlays are forbidden in negative form.
 *    3. The product background must never bleed into the result.
 */

export interface OpenAITryOnPromptOptions {
  category: CategoryId;
  /** Optional product subtype — used for hand-jewelry. */
  productSubtype?: HandJewelryType;
  /** Whether an alpha mask is attached to the edit call. */
  maskUsed: boolean;
  /** Target finger when productSubtype === "ring". */
  targetFinger?: FingerId;
  /** Optional free-form merchant context. */
  notes?: string;
}

const FINGER_LABEL: Record<FingerId, string> = {
  index: "index finger",
  middle: "middle finger",
  ring: "ring finger",
  pinky: "pinky finger",
};

function watchPrompt(o: OpenAITryOnPromptOptions): string {
  const base =
    "Use the customer wrist photo as the base image. Use the transparent " +
    "watch product image as the exact product reference.\n\n" +
    "Add the watch naturally around the visible wrist with realistic " +
    "scale, perspective, wrist curvature, and contact shadows.\n\n" +
    "The watch strap must wrap around the wrist instead of appearing as a " +
    "flat sticker. The watch face must remain sharp and recognizable. The " +
    "metal bracelet or strap should follow the cylindrical shape of the " +
    "wrist.\n\n" +
    "Preserve the original hand, fingers, nails, skin texture, arm hair, " +
    "lighting, background, and anatomy.\n\n" +
    "Do not create new fingers. Do not distort the hand. Do not move the " +
    "wrist. Do not change the background. Do not paste the watch as a flat " +
    "overlay. Do not include any product background. Do not duplicate the " +
    "watch. Return a realistic e-commerce virtual try-on preview.";
  const localised = o.maskUsed
    ? "Edit only the masked wrist area. Do not change anything outside the masked area."
    : "Edit only the wrist area where the watch should appear.";
  return `${base}\n\n${localised}`;
}

function glassesPrompt(o: OpenAITryOnPromptOptions): string {
  const base =
    "Use the customer face photo as the base image. Use the glasses product " +
    "image as the exact product reference.\n\n" +
    "Place the glasses naturally on the face, aligned with the eyes, nose " +
    "bridge, and temples. The frame must have realistic scale, perspective, " +
    "and shadows.\n\n" +
    "Preserve the original face identity, expression, eyes, skin texture, " +
    "hair, lighting, and background.\n\n" +
    "Do not distort the face. Do not change the eyes. Do not change the " +
    "nose or mouth. Do not create extra glasses. Do not paste the product " +
    "as a flat sticker. Do not include any product background. Return a " +
    "realistic e-commerce virtual try-on preview.";
  const localised = o.maskUsed
    ? "Edit only the masked eye and glasses area. Do not change anything outside the masked area."
    : "Edit only the glasses placement area around the eyes and nose bridge.";
  return `${base}\n\n${localised}`;
}

function headwearPrompt(o: OpenAITryOnPromptOptions): string {
  const base =
    "Use the customer portrait photo as the base image. Use the headwear " +
    "product image as the exact product reference.\n\n" +
    "Place the cap, hat, beanie, or headwear naturally on the person's head " +
    "with realistic scale, perspective, and shadows. It should sit naturally " +
    "on the head and align with the forehead and hairline.\n\n" +
    "Preserve the original face, expression, eyes, skin, hair as much as " +
    "possible, lighting, and background.\n\n" +
    "Do not distort the face. Do not change the person's identity. Do not " +
    "remove the head. Do not create a second hat. Do not paste the product " +
    "as a flat sticker. Do not include any product background. Return a " +
    "realistic e-commerce virtual try-on preview.";
  const localised = o.maskUsed
    ? "Edit only the masked headwear area. Do not change anything outside the masked area."
    : "Edit only the top-of-head area where the headwear should appear.";
  return `${base}\n\n${localised}`;
}

function ringPrompt(o: OpenAITryOnPromptOptions): string {
  const fingerSentence = o.targetFinger
    ? `If a target finger is provided, use that finger: ${FINGER_LABEL[o.targetFinger]}.`
    : "If a target finger is provided, use that finger: {targetFinger}.";
  const base =
    "Use the customer hand photo as the base image. Use the ring product " +
    "image as the exact product reference.\n\n" +
    "Place the ring naturally on one selected finger only. " +
    fingerSentence +
    " The ring must wrap around the finger with realistic scale, " +
    "perspective, contact shadows, and metal reflections.\n\n" +
    "Preserve the original hand, fingers, nails, skin texture, lighting, " +
    "and background.\n\n" +
    "Do not place the ring across two fingers. Do not create extra fingers. " +
    "Do not distort the hand. Do not add extra jewelry. Do not paste the " +
    "product as a flat sticker. Do not include any product background. " +
    "Return a realistic e-commerce virtual try-on preview.";
  const localised = o.maskUsed
    ? "Edit only the masked hand/jewelry area. Do not change anything outside the masked area."
    : "Edit only the intended jewelry placement area.";
  return `${base}\n\n${localised}`;
}

function braceletPrompt(o: OpenAITryOnPromptOptions): string {
  const base =
    "Use the customer hand or wrist photo as the base image. Use the " +
    "bracelet product image as the exact product reference.\n\n" +
    "Place the bracelet naturally around the wrist with realistic scale, " +
    "perspective, curvature, and contact shadows. The bracelet should " +
    "follow the cylindrical shape of the wrist.\n\n" +
    "Preserve the original hand, fingers, nails, skin texture, lighting, " +
    "and background.\n\n" +
    "Do not distort the hand. Do not create extra jewelry. Do not paste " +
    "the product as a flat sticker. Do not include any product background. " +
    "Return a realistic e-commerce virtual try-on preview.";
  const localised = o.maskUsed
    ? "Edit only the masked hand/jewelry area. Do not change anything outside the masked area."
    : "Edit only the intended jewelry placement area.";
  return `${base}\n\n${localised}`;
}

function genericHandJewelryPrompt(o: OpenAITryOnPromptOptions): string {
  const base =
    "Use the customer hand photo as the base image. Use the jewelry product " +
    "image as the exact product reference.\n\n" +
    "Place the jewelry naturally on the appropriate hand, finger, or wrist " +
    "area with realistic scale, perspective, and shadows.\n\n" +
    "Preserve the original hand anatomy, skin texture, nails, lighting, " +
    "and background.\n\n" +
    "Do not create extra fingers. Do not distort the hand. Do not place " +
    "jewelry across multiple fingers unless the product is designed for " +
    "that. Do not include any product background. Return a realistic " +
    "e-commerce virtual try-on preview.";
  const localised = o.maskUsed
    ? "Edit only the masked hand/jewelry area. Do not change anything outside the masked area."
    : "Edit only the intended jewelry placement area.";
  return `${base}\n\n${localised}`;
}

function clothesPrompt(o: OpenAITryOnPromptOptions): string {
  const base =
    "Use the customer body photo as the base image. Use the clothing " +
    "product image as the exact product reference.\n\n" +
    "Dress the person in the selected garment while preserving identity, " +
    "face, hair, body proportions, pose, lighting, and background.\n\n" +
    "The garment must have realistic fit, folds, shadows, fabric texture, " +
    "and perspective. Preserve the clothing's color, pattern, logos, and " +
    "visible details as much as possible.\n\n" +
    "Do not distort the body. Do not change the person's identity. Do not " +
    "change the background. Do not create extra limbs. Do not paste the " +
    "clothing as a flat sticker. Do not include any product background. " +
    "Return a realistic e-commerce virtual try-on preview.";
  const localised = o.maskUsed
    ? "Edit only the masked clothing/body area. Do not change anything outside the masked area."
    : "Edit only the area where the garment should appear.";
  return `${base}\n\n${localised}`;
}

export function buildOpenAITryOnPrompt(o: OpenAITryOnPromptOptions): string {
  let base: string;
  switch (o.category) {
    case "watch":
      base = watchPrompt(o);
      break;
    case "glasses":
      base = glassesPrompt(o);
      break;
    case "headwear":
      base = headwearPrompt(o);
      break;
    case "hand-jewelry":
      if (o.productSubtype === "ring") base = ringPrompt(o);
      else if (o.productSubtype === "bracelet") base = braceletPrompt(o);
      else base = genericHandJewelryPrompt(o);
      break;
    case "clothes":
      base = clothesPrompt(o);
      break;
    default: {
      // Exhaustive check — TS will error if a new CategoryId is added.
      const _never: never = o.category;
      throw new Error(`Unsupported category: ${String(_never)}`);
    }
  }
  if (o.notes && o.notes.trim()) {
    base += `\n\nAdditional context: ${o.notes.trim()}`;
  }
  return base;
}

/**
 * Per-category mask flags. Each defaults to true unless explicitly set
 * to "false" via env. Allows operators to disable masked editing for a
 * specific category without rebuilding.
 */
export function isMaskedEditEnabledFor(category: CategoryId): boolean {
  const globalFlag = process.env.OPENAI_USE_MASKED_EDIT?.trim().toLowerCase();
  if (globalFlag === "false") return false;

  const perCategoryRaw = (() => {
    switch (category) {
      case "watch":
        return process.env.WATCH_USE_MASKED_EDIT;
      case "glasses":
        return process.env.GLASSES_USE_MASKED_EDIT;
      case "headwear":
        return process.env.HEADWEAR_USE_MASKED_EDIT;
      case "hand-jewelry":
        return process.env.HAND_JEWELRY_USE_MASKED_EDIT;
      case "clothes":
        return process.env.CLOTHES_USE_MASKED_EDIT;
    }
  })();
  return (perCategoryRaw?.trim().toLowerCase() ?? "true") !== "false";
}
