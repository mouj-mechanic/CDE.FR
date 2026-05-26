import type { CategoryId, FingerId, HandJewelryType } from "@/types";
import { preservationFooter, productLockFooter } from "./preservationBlocks";

/**
 * OpenAI GPT Image prompt builder.
 *
 *  Distinct from `lib/providers/prompts.ts` (which targets fal.ai's FLUX
 *  models) because:
 *    - GPT Image accepts multiple reference images via `image[]`.
 *    - Mask convention is opposite (transparent = editable). The wording
 *      reflects this.
 *    - Hand-jewelry has subtype-specific wording (ring vs bracelet) and
 *      can address a target finger.
 *
 *  Each prompt is composed of:
 *    1. A short "what to do" lead specific to the category.
 *    2. The shared preservation footer (customer + product + no-hallucination
 *       + mask blocks). See `preservationBlocks.ts`.
 */

export interface OpenAITryOnPromptOptions {
  category: CategoryId;
  productSubtype?: HandJewelryType;
  maskUsed: boolean;
  targetFinger?: FingerId;
  notes?: string;
  /**
   * True when the product has been pre-composited onto the base image and
   * will be re-stamped on top after the AI returns (product-lock
   * pipeline). The prompt switches to "integrate only — do not redraw".
   */
  productLocked?: boolean;
}

const FINGER_LABEL: Record<FingerId, string> = {
  index: "index finger",
  middle: "middle finger",
  ring: "ring finger",
  pinky: "pinky finger",
};

// ──────────────────────────────────────────────────────────────────────────
//  Category-specific leads — product-LOCK variants
//  ("the product has already been positioned, only integrate").
// ──────────────────────────────────────────────────────────────────────────

/**
 * Generic accessory lock lead. Exported so non-default callers (e.g.
 * future operator overrides) can reach for the generic wording without
 * picking a specific category.
 */
export const ACCESSORY_LOCK_GENERIC =
  "Use the customer image as the base. The product has already been " +
  "positioned as a locked reference layer. Edit only the masked area " +
  "to improve realistic contact shadows, edge blending, local " +
  "lighting, and surface integration. Do not redesign, move, replace, " +
  "recolor, or redraw the product. Do not change the customer, hand, " +
  "fingers, face, skin, body, background, pose, or lighting outside " +
  "the mask. Everything outside the mask must remain unchanged.";

function watchLockLead(): string {
  return (
    "The watch is already positioned on the wrist as a locked product " +
    "reference. Improve only the local contact shadows, wrist " +
    "integration, edge blending, and realistic lighting around the " +
    "watch. Do not move the watch. Do not redraw the watch. Do not " +
    "change the dial, bracelet, metal, size, color, or details. Do " +
    "not alter the hand, fingers, skin texture, arm hair, background, " +
    "or anatomy."
  );
}

function glassesLockLead(): string {
  return (
    "The glasses are already positioned as a locked product reference. " +
    "Improve only local shadows, reflections, and blending around the " +
    "frame, nose bridge, and temples. Do not redesign the frame. Do " +
    "not change the eyes, face, skin, mouth, hair, identity, or " +
    "background."
  );
}

function ringLockLead(opts: OpenAITryOnPromptOptions): string {
  const finger = opts.targetFinger
    ? FINGER_LABEL[opts.targetFinger]
    : "the selected finger";
  return (
    `The ring is already positioned on ${finger} as a locked product ` +
    "reference. Improve only contact shadows, reflections, and " +
    "blending around the ring. Do not change the ring design, stones, " +
    "metal, shape, or color. Do not alter fingers, nails, hand " +
    "anatomy, skin, or background."
  );
}

function braceletLockLead(): string {
  return (
    "The bracelet is already positioned around the wrist as a locked " +
    "product reference. Improve only contact shadows, reflections, " +
    "and blending around the bracelet. Do not change the bracelet " +
    "design, stones, metal, shape, or color. Do not alter the wrist, " +
    "fingers, hand anatomy, skin, or background."
  );
}

function genericHandJewelryLockLead(): string {
  return (
    "The jewelry is already positioned as a locked product reference. " +
    "Improve only contact shadows, reflections, and blending around " +
    "the jewelry. Do not change the ring or bracelet design, stones, " +
    "metal, shape, or color. Do not alter fingers, nails, hand " +
    "anatomy, skin, or background."
  );
}

function headwearLockLead(): string {
  return (
    "The headwear is already positioned as a locked product reference. " +
    "Improve only edge blending, shadows, and lighting around the " +
    "headwear. Do not redesign the product. Do not change the face, " +
    "hair, identity, or background."
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Category-specific leads — placement variants
//  (used when the product was NOT pre-composited; the AI must still
//  place it on the body).
// ──────────────────────────────────────────────────────────────────────────

function watchLead(): string {
  return (
    "Use the customer wrist photo as the base image. Use the transparent " +
    "watch product image as the exact product reference. Add the watch " +
    "naturally around the visible wrist with realistic scale, perspective, " +
    "wrist curvature, and natural contact shadows. The strap must wrap " +
    "around the wrist instead of appearing as a flat sticker. The watch " +
    "face must remain sharp and recognizable; preserve the dial layout, " +
    "hour markers, sub-dials, hands, logo, bracelet links, and metal " +
    "finish exactly as in the product reference."
  );
}

function glassesLead(): string {
  return (
    "Use the customer face photo as the base image. Use the glasses " +
    "product image as the exact product reference. Place the frame " +
    "naturally on the face, aligned with the eyes, nose bridge, and " +
    "temples, with realistic scale, perspective, and shadows. Preserve " +
    "the exact frame shape, color, lens tint, bridge, and temples from " +
    "the product reference."
  );
}

function headwearLead(): string {
  return (
    "Use the customer portrait photo as the base image. Use the headwear " +
    "product image as the exact product reference. Place the cap, hat, or " +
    "beanie naturally on the head with realistic scale, perspective, and " +
    "shadows. It must sit naturally on the head and align with the " +
    "forehead and hairline. Preserve the exact product shape, color, " +
    "fabric, logo, and brim shape from the reference."
  );
}

function ringLead(opts: OpenAITryOnPromptOptions): string {
  const finger = opts.targetFinger
    ? FINGER_LABEL[opts.targetFinger]
    : "the selected finger";
  return (
    "Use the customer hand photo as the base image. Use the ring product " +
    "image as the exact product reference. Place the ring on " +
    finger +
    " only. The ring must wrap around the finger with realistic scale, " +
    "perspective, contact shadows, and metal reflections. Preserve the " +
    "exact ring shape, metal finish, gemstones, settings, and engravings " +
    "from the reference."
  );
}

function braceletLead(): string {
  return (
    "Use the customer hand or wrist photo as the base image. Use the " +
    "bracelet product image as the exact product reference. Place the " +
    "bracelet around the wrist with realistic scale, perspective, " +
    "curvature, and contact shadows. The bracelet should follow the " +
    "cylindrical shape of the wrist. Preserve the exact bracelet shape, " +
    "links, metal finish, gemstones, and pattern from the reference."
  );
}

function genericHandJewelryLead(): string {
  return (
    "Use the customer hand photo as the base image. Use the jewelry " +
    "product image as the exact product reference. Place the jewelry " +
    "naturally on the appropriate hand, finger, or wrist area with " +
    "realistic scale, perspective, and shadows. Preserve the exact " +
    "jewelry shape, material, color, gemstones, and pattern."
  );
}

function clothesLead(): string {
  return (
    "Use the customer body photo as the base image. Use the clothing " +
    "product image as the exact product reference. Dress the person in " +
    "the garment with realistic fit, folds, fabric texture, and " +
    "perspective. Preserve the exact garment color, pattern, logos, " +
    "fabric texture, and cut from the reference. Preserve the face, " +
    "hair, hands, and identity exactly. Avoid altering anything " +
    "outside the garment area."
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

function pickAccessoryLockLead(o: OpenAITryOnPromptOptions): string {
  switch (o.category) {
    case "watch":
      return watchLockLead();
    case "glasses":
      return glassesLockLead();
    case "headwear":
      return headwearLockLead();
    case "hand-jewelry":
      if (o.productSubtype === "ring") return ringLockLead(o);
      if (o.productSubtype === "bracelet") return braceletLockLead();
      return genericHandJewelryLockLead();
    case "clothes":
      // Clothes do not use the lock pipeline; this branch is unreachable
      // in practice but kept for exhaustiveness.
      return ACCESSORY_LOCK_GENERIC;
  }
}

function pickPlacementLead(o: OpenAITryOnPromptOptions): string {
  switch (o.category) {
    case "watch":
      return watchLead();
    case "glasses":
      return glassesLead();
    case "headwear":
      return headwearLead();
    case "hand-jewelry":
      if (o.productSubtype === "ring") return ringLead(o);
      if (o.productSubtype === "bracelet") return braceletLead();
      return genericHandJewelryLead();
    case "clothes":
      return clothesLead();
  }
}

export function buildOpenAITryOnPrompt(o: OpenAITryOnPromptOptions): string {
  // Clothes never use the lock pipeline (garments must deform to the
  // body — re-stamping the original PNG breaks fit). Everything else
  // gets the "the product is already positioned, integrate only" lead
  // when productLocked is true.
  const useLock = Boolean(o.productLocked) && o.category !== "clothes";

  const lead = useLock
    ? pickAccessoryLockLead(o)
    : pickPlacementLead(o);

  const footer = useLock
    ? productLockFooter()
    : preservationFooter({ maskUsed: o.maskUsed });

  let prompt = `${lead}\n\n${footer}`;
  if (o.notes && o.notes.trim()) {
    prompt += `\n\nAdditional context: ${o.notes.trim()}`;
  }
  prompt += useLock
    ? "\n\nReturn a realistic e-commerce virtual try-on preview. Do " +
      "not redraw the product itself — only refine local lighting and " +
      "shadows."
    : "\n\nReturn a realistic e-commerce virtual try-on preview. Do " +
      "not include any product background. Do not paste the product " +
      "as a flat sticker.";
  return prompt;
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
