import type { TryOnRequest, TryOnResponse } from "@/types";
import { falTryOn } from "./providers/fal";
import { pickMockResult } from "./mockResults";

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function mockGenerate(params: TryOnRequest): Promise<TryOnResponse> {
  await randomDelay(4000, 6000);
  return {
    resultUrl: pickMockResult(params.category),
    generatedAt: Date.now(),
    mock: true,
  };
}

/**
 * Génère une image d'essayage virtuel.
 *
 * Providers supportés :
 *   - "fal" : fal.ai (FLUX.1 Kontext multi-image edit) — couvre les 5 catégories
 *   - vide  : mode mock (placeholder local)
 *
 * Pour brancher un autre provider :
 *   - Ajouter un fichier dans lib/providers/<nom>.ts qui exporte (params, key) => TryOnResponse
 *   - L'ajouter au switch ci-dessous
 */
export async function generateTryOnImage(
  params: TryOnRequest
): Promise<TryOnResponse> {
  const provider = process.env.AI_TRYON_PROVIDER?.trim().toLowerCase();

  if (!provider) {
    return mockGenerate(params);
  }

  switch (provider) {
    case "fal": {
      const apiKey =
        process.env.FAL_KEY?.trim() ||
        process.env.AI_TRYON_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(
          "Clé API fal.ai manquante. Définissez FAL_KEY dans .env.local."
        );
      }
      return falTryOn(params, apiKey);
    }
    // case "replicate":
    //   return replicateTryOn(params, process.env.AI_TRYON_API_KEY!);
    // case "openai":
    //   return openaiImageEdit(params, process.env.AI_TRYON_API_KEY!);
    default:
      throw new Error(
        `Provider IA "${provider}" inconnu. Providers disponibles : "fal".`
      );
  }
}
