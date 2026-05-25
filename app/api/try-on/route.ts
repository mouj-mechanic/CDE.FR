import { NextRequest, NextResponse } from "next/server";
import { isValidCategoryId } from "@/lib/categories";
import { generateTryOnImage, ProviderConfigError } from "@/lib/tryOnService";
import { ACCEPTED_IMAGE_TYPES, MAX_FILE_SIZE } from "@/lib/utils";
import { trackTryOnUsage } from "@/lib/usage";
import type { CategoryId, TryOnRequest } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const IMAGE_PATH_RX = /\.(jpe?g|png|webp|gif|avif)(?:\?.*)?(?:#.*)?$/i;

function validateImageFile(file: File, label: string): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return `${label} : format non accepté (JPG, PNG, WebP uniquement).`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `${label} : fichier trop volumineux (max 10 Mo).`;
  }
  return null;
}

function looksLikeImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return IMAGE_PATH_RX.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Sanitize any error message coming from a provider before sending it to the
 * client. We strip anything that could leak the FAL_KEY value or query params
 * that contain credentials.
 */
function safeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unknown error";
  const falKey = process.env.FAL_KEY?.trim();
  let cleaned = raw;
  if (falKey) {
    cleaned = cleaned.split(falKey).join("[REDACTED]");
  }
  // Remove any obvious "key=xxx" / "Authorization: ..." pairs just in case.
  cleaned = cleaned.replace(/(api[_-]?key|authorization|bearer)[=:\s]+\S+/gi, "$1=[REDACTED]");
  return cleaned;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let categoryForUsage: CategoryId | null = null;

  const envProvider =
    process.env.AI_TRYON_PROVIDER?.trim().toLowerCase() || "mock";
  const hasFalKey = Boolean(
    process.env.FAL_KEY?.trim() || process.env.AI_TRYON_API_KEY?.trim()
  );

  try {
    const formData = await request.formData();

    const categoryRaw = formData.get("category");
    if (typeof categoryRaw !== "string" || !isValidCategoryId(categoryRaw)) {
      return NextResponse.json(
        { error: "Catégorie invalide ou manquante." },
        { status: 400 }
      );
    }
    const category = categoryRaw as CategoryId;
    categoryForUsage = category;

    const userImage = formData.get("userImage");
    if (!(userImage instanceof File) || userImage.size === 0) {
      return NextResponse.json(
        { error: "Veuillez importer une photo de vous." },
        { status: 400 }
      );
    }
    const userImageError = validateImageFile(userImage, "Photo utilisateur");
    if (userImageError) {
      return NextResponse.json({ error: userImageError }, { status: 400 });
    }

    const productImages: File[] = [];
    const productImagesEntries = formData.getAll("productImages");
    for (const entry of productImagesEntries) {
      if (entry instanceof File && entry.size > 0) {
        const err = validateImageFile(entry, "Image produit");
        if (err) {
          return NextResponse.json({ error: err }, { status: 400 });
        }
        productImages.push(entry);
      }
    }

    let productUrlsRaw: string[] = [];
    const urlsRaw = formData.get("productUrls");
    if (typeof urlsRaw === "string" && urlsRaw.trim()) {
      try {
        const parsed: unknown = JSON.parse(urlsRaw);
        if (Array.isArray(parsed)) {
          productUrlsRaw = parsed.filter(
            (u): u is string => typeof u === "string" && u.trim().length > 0
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Format des URLs produit invalide." },
          { status: 400 }
        );
      }
    }

    // Only pass URLs that look like image URLs through to the AI model — raw
    // product page URLs (e.g. https://shop.com/products/foo) confuse FLUX.
    const productUrls = productUrlsRaw.filter(looksLikeImageUrl);
    const droppedUrls = productUrlsRaw.length - productUrls.length;

    if (productImages.length === 0 && productUrls.length === 0) {
      const reason =
        droppedUrls > 0
          ? "Aucune image produit exploitable. Importez une image ou utilisez un lien produit dont l'image a été détectée."
          : "Veuillez ajouter au moins un article (lien produit ou image).";
      return NextResponse.json({ error: reason }, { status: 400 });
    }

    const notesRaw = formData.get("notes");
    const notes =
      typeof notesRaw === "string" && notesRaw.trim()
        ? notesRaw.trim()
        : undefined;

    const merchantIdRaw = formData.get("merchantId");
    const merchantId =
      typeof merchantIdRaw === "string" && merchantIdRaw.trim()
        ? merchantIdRaw.trim()
        : undefined;

    const params: TryOnRequest = {
      category,
      userImage,
      productImages,
      productUrls,
      notes,
      merchantId,
    };

    console.info(
      `[try-on] start provider=${envProvider} category=${category} hasFalKey=${hasFalKey} productImages=${productImages.length} productUrls=${productUrls.length}`
    );

    const result = await generateTryOnImage(params);
    const durationMs = Date.now() - startedAt;

    console.info(
      `[try-on] success provider=${result.provider} model=${result.model} mock=${Boolean(result.mock)} durationMs=${durationMs}`
    );

    trackTryOnUsage({
      merchantId,
      category,
      provider: result.provider ?? "unknown",
      model: result.model ?? "unknown",
      mock: Boolean(result.mock),
      success: true,
      durationMs,
    });

    return NextResponse.json({ ...result, durationMs });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const safeMessage = safeErrorMessage(error);

    // Misconfiguration (e.g. FAL_KEY missing while provider=fal) — explicit 500.
    if (error instanceof ProviderConfigError) {
      console.error(
        `[try-on] config-error provider=${envProvider} hasFalKey=${hasFalKey} durationMs=${durationMs} message=${safeMessage}`
      );
      if (categoryForUsage) {
        trackTryOnUsage({
          category: categoryForUsage,
          provider: envProvider,
          model: "unknown",
          mock: false,
          success: false,
          durationMs,
          errorCode: "ProviderConfigError",
        });
      }
      return NextResponse.json(
        {
          error: safeMessage,
          details: safeMessage,
          provider: envProvider,
        },
        { status: 500 }
      );
    }

    // Real generation failure on fal (network, model error, quota, etc.)
    if (envProvider === "fal" || envProvider === "auto") {
      console.error(
        `[try-on] generation-failed provider=${envProvider} category=${categoryForUsage} durationMs=${durationMs} message=${safeMessage}`
      );
      if (categoryForUsage) {
        trackTryOnUsage({
          category: categoryForUsage,
          provider: envProvider,
          model: "unknown",
          mock: false,
          success: false,
          durationMs,
          errorCode: error instanceof Error ? error.name : "Error",
        });
      }
      return NextResponse.json(
        {
          error: "Real AI generation failed",
          details: safeMessage,
          provider: "fal",
        },
        { status: 500 }
      );
    }

    console.error("[try-on] unexpected-error", safeMessage);
    if (categoryForUsage) {
      trackTryOnUsage({
        category: categoryForUsage,
        provider: "unknown",
        model: "unknown",
        mock: false,
        success: false,
        durationMs,
        errorCode: error instanceof Error ? error.name : "Error",
      });
    }
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
