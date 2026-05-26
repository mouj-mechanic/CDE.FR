import type { CategoryId, FingerId, HandJewelryType } from "@/types";
import { preservationFooter } from "./preservationBlocks";

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
}

const FINGER_LABEL: Record<FingerId, string> = {
  index: "index finger",
  middle: "middle finger",
  ring: "ring finger",
  pinky: "pinky finger",
};

// ──────────────────────────────────────────────────────────────────────────
//  Category-specific leads
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
    "fabric texture, and cut from the reference."
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

export function buildOpenAITryOnPrompt(o: OpenAITryOnPromptOptions): string {
  let lead: string;
  switch (o.category) {
    case "watch":
      lead = watchLead();
      break;
    case "glasses":
      lead = glassesLead();
      break;
    case "headwear":
      lead = headwearLead();
      break;
    case "hand-jewelry":
      if (o.productSubtype === "ring") lead = ringLead(o);
      else if (o.productSubtype === "bracelet") lead = braceletLead();
      else lead = genericHandJewelryLead();
      break;
    case "clothes":
      lead = clothesLead();
      break;
    default: {
      const _never: never = o.category;
      throw new Error(`Unsupported category: ${String(_never)}`);
    }
  }

  const footer = preservationFooter({ maskUsed: o.maskUsed });
  let prompt = `${lead}\n\n${footer}`;
  if (o.notes && o.notes.trim()) {
    prompt += `\n\nAdditional context: ${o.notes.trim()}`;
  }
  prompt +=
    "\n\nReturn a realistic e-commerce virtual try-on preview. Do not " +
    "include any product background. Do not paste the product as a flat " +
    "sticker.";
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
