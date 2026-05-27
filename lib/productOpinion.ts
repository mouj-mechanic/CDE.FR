/**
 * Safe, templated "shopping assistant" opinion about the rendered
 * product. We deliberately avoid any LLM call here — opinions are
 * generated from a small bank of category-specific phrases so we can
 * guarantee that:
 *
 *  - we never promise the product "suits you" (avoids morphological
 *    or body-image claims that would be inappropriate);
 *  - we never push the customer to buy ("you should buy this");
 *  - we never make medical / health claims;
 *  - we never expose technical jargon (mask, alpha, OpenAI, ...).
 *
 * The opinion is style-focused, short, and warm. If we ever want to
 * personalise further we can hook in a moderated LLM call here, but
 * the templated path remains the safe default.
 */

import type { CategoryId, TryOnWarning, QualityStatus } from "@/types";

const WATCH_PHRASES = [
  "Cette montre apporte un style sportif et affirmé.",
  "Le boîtier sombre et les détails colorés attirent bien le regard.",
  "Elle fonctionne très bien pour un look casual ou streetwear.",
  "Un cadran net et un bracelet structuré — l’ensemble reste élégant.",
];

const GLASSES_PHRASES = [
  "Une monture qui structure le regard avec finesse.",
  "Ces lunettes ajoutent une touche moderne sans être trop chargées.",
  "Belle géométrie — l’effet est discret mais marqué.",
  "Un design propre qui s’intègre bien au quotidien.",
];

const CLOTHES_PHRASES = [
  "Une coupe nette et un tombé soigné.",
  "L’ensemble reste équilibré, ni trop ample ni trop ajusté.",
  "Une pièce qui se prête bien à des tenues variées.",
  "Le tissu et la couleur fonctionnent bien sur cette base.",
];

const HEADWEAR_PHRASES = [
  "Un volume mesuré qui équilibre bien la silhouette.",
  "Couleur et coupe travaillées — l’effet est élégant.",
  "Un accessoire qui apporte une touche immédiate sans trop en faire.",
  "Belle finition — l’ensemble reste harmonieux.",
];

const HAND_JEWELRY_PHRASES = [
  "Une pièce délicate qui reste lisible à l’œil.",
  "Beau jeu de matières — l’ensemble respire la qualité.",
  "Un design fin qui se porte facilement au quotidien.",
  "L’effet est précis sans être ostentatoire.",
];

const FALLBACK_NOTE =
  "J’ai privilégié la fidélité du produit plutôt qu’un rendu trop retouché.";

export interface ProductOpinionInput {
  category: CategoryId;
  productTitle?: string;
  warnings?: TryOnWarning[];
  qualityStatus?: QualityStatus;
  fallbackUsed?: boolean;
}

function bankForCategory(category: CategoryId): string[] {
  switch (category) {
    case "watch":
      return WATCH_PHRASES;
    case "glasses":
      return GLASSES_PHRASES;
    case "clothes":
      return CLOTHES_PHRASES;
    case "headwear":
      return HEADWEAR_PHRASES;
    case "hand-jewelry":
      return HAND_JEWELRY_PHRASES;
    default:
      return WATCH_PHRASES;
  }
}

function pickPhrase(
  bank: string[],
  seedKey: string | undefined
): string {
  if (bank.length === 0) return "";
  if (!seedKey) return bank[0];
  // Stable pick — the same product title returns the same phrase so
  // re-renders don’t shuffle the wording.
  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) {
    hash = (hash * 31 + seedKey.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % bank.length;
  return bank[idx];
}

export function generateProductOpinion(
  input: ProductOpinionInput
): string {
  const phrase = pickPhrase(
    bankForCategory(input.category),
    input.productTitle ?? input.category
  );
  const usedFallback =
    input.fallbackUsed === true ||
    input.qualityStatus === "fallback-preview" ||
    (typeof input.qualityStatus === "string" &&
      input.qualityStatus.startsWith("fallback_")) ||
    (input.warnings ?? []).some(
      (w) =>
        w.code === "anti-ghost-applied" ||
        w.code === "product-fidelity-check-failed" ||
        w.code === "customer_preservation_fallback_used"
    );
  return usedFallback ? `${phrase} ${FALLBACK_NOTE}` : phrase;
}
