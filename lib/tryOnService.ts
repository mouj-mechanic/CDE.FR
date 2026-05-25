import type { CategoryId, TryOnRequest, TryOnResponse } from "@/types";
import { pickMockResult } from "./mockResults";
import { falKontextTryOn, FAL_KONTEXT_MODEL } from "./providers/falKontext";
import {
  falInpaintTryOn,
  FAL_INPAINT_PRIMARY_MODEL,
} from "./providers/falInpaint";
import { fashnTryOn } from "./providers/fashn";

/**
 * Custom error raised when the configured provider cannot be honored —
 * e.g. `AI_TRYON_PROVIDER=fal` but `FAL_KEY` is missing. The API route
 * uses this to distinguish "misconfiguration" (500 with explicit message)
 * from a transient network/model error.
 */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

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
    provider: "mock",
    model: "mock",
    category: params.category,
  };
}

/** Categories where FASHN gives noticeably better fidelity than FLUX Kontext. */
const FASHN_CATEGORIES: CategoryId[] = ["clothes"];

interface ProviderEnv {
  provider: string;
  falKey?: string;
  fashnKey?: string;
}

function readProviderEnv(): ProviderEnv {
  const provider =
    process.env.AI_TRYON_PROVIDER?.trim().toLowerCase() || "mock";
  const falKey =
    process.env.FAL_KEY?.trim() || process.env.AI_TRYON_API_KEY?.trim();
  const fashnKey = process.env.FASHN_API_KEY?.trim();
  return { provider, falKey, fashnKey };
}

/**
 * Génère une image d'essayage virtuel en routant intelligemment selon la
 * catégorie + les providers disponibles.
 *
 * - `AI_TRYON_PROVIDER=mock` (ou vide)  → image factice locale.
 * - `AI_TRYON_PROVIDER=fal`             → fal.ai routing :
 *     - clothes        : FASHN (si configuré ou disponible), sinon FLUX Kontext
 *     - headwear/glasses/watch/hand-jewelry : FLUX Kontext multi-image
 * - `AI_TRYON_PROVIDER=auto`            → équivalent à `fal` si FAL_KEY présent,
 *                                         sinon mode mock.
 */
export async function generateTryOnImage(
  params: TryOnRequest
): Promise<TryOnResponse> {
  const { provider, falKey, fashnKey } = readProviderEnv();

  if (provider === "mock") {
    return mockGenerate(params);
  }

  if (provider === "auto") {
    if (!falKey) return mockGenerate(params);
    return runFal(params, falKey, fashnKey);
  }

  if (provider === "fal") {
    if (!falKey) {
      throw new ProviderConfigError(
        "FAL_KEY is missing. AI_TRYON_PROVIDER=fal but no fal.ai key is configured."
      );
    }
    return runFal(params, falKey, fashnKey);
  }

  throw new ProviderConfigError(
    `Provider IA "${provider}" inconnu. Valeurs supportées : "mock", "auto", "fal".`
  );
}

async function runFal(
  params: TryOnRequest,
  falKey: string,
  fashnKey?: string
): Promise<TryOnResponse> {
  // ─── Inpainting refinement path ──────────────────────────────────────
  // When the caller provides a deterministic composite + contact-band
  // mask (currently the watch category), we route to FLUX Fill instead
  // of Kontext. The model preserves unmasked pixels exactly, so the
  // dial — logo, hands, numbers — is mathematically impossible to
  // alter. Only the ~10-px ring around the silhouette is repainted to
  // add realistic contact shadows and skin blending.
  if (params.inpaintComposite && params.inpaintMask) {
    return falInpaintTryOn(
      {
        ...params,
        inpaintComposite: params.inpaintComposite,
        inpaintMask: params.inpaintMask,
      },
      falKey
    );
  }

  const useFashn = FASHN_CATEGORIES.includes(params.category);

  if (useFashn) {
    // Try FASHN first (better for clothes). If unavailable / throws, fall
    // back to FLUX Kontext so the user always gets an image.
    try {
      // FASHN goes through fal too; FASHN_API_KEY is reserved for a future
      // direct integration. For now we just use FAL_KEY.
      return await fashnTryOn(params, fashnKey || falKey);
    } catch (error) {
      console.warn(
        "[tryOnService] FASHN failed, falling back to FLUX Kontext:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return falKontextTryOn(params, falKey);
}

/** Exposed for the API route metadata. */
export const PROVIDER_MODELS = {
  fashn: ["fashn/tryon/v1.6", "fal-ai/fashn/tryon"],
  flux: FAL_KONTEXT_MODEL,
  fluxInpaint: FAL_INPAINT_PRIMARY_MODEL,
};
