import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { isValidCategoryId } from "@/lib/categories";
import { generateTryOnImage, ProviderConfigError } from "@/lib/tryOnService";
import { ACCEPTED_IMAGE_TYPES, MAX_FILE_SIZE } from "@/lib/utils";
import { trackTryOnUsage } from "@/lib/usage";
import type {
  CategoryId,
  FingerId,
  HandJewelryType,
  RenderMode,
  TryOnRequest,
  TryOnWarning,
  WatchPlacementResponse,
} from "@/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const IMAGE_PATH_RX = /\.(jpe?g|png|webp|gif|avif)(?:\?.*)?(?:#.*)?$/i;
const ACCESSORY_CATEGORIES: CategoryId[] = [
  "headwear",
  "glasses",
  "watch",
  "hand-jewelry",
];

function validateImageFile(file: File, label: string): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return `${label} : format non accepté (JPG, PNG, WebP uniquement).`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `${label} : fichier trop volumineux (max 10 Mo).`;
  }
  return null;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function looksLikeImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return IMAGE_PATH_RX.test(u.pathname);
  } catch {
    return false;
  }
}

function safeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unknown error";
  const falKey = process.env.FAL_KEY?.trim();
  let cleaned = raw;
  if (falKey) cleaned = cleaned.split(falKey).join("[REDACTED]");
  cleaned = cleaned.replace(
    /(api[_-]?key|authorization|bearer)[=:\s]+\S+/gi,
    "$1=[REDACTED]"
  );
  return cleaned;
}

function parseWarnings(raw: string | null | undefined): TryOnWarning[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (w): w is TryOnWarning =>
          typeof w === "object" &&
          w !== null &&
          typeof (w as { code?: unknown }).code === "string" &&
          typeof (w as { message?: unknown }).message === "string"
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  // Preserve the file's MIME so transparent PNGs are not re-encoded as JPEG.
  return `data:${file.type || "image/png"};base64,${buf.toString("base64")}`;
}

async function uploadPreviewToCdn(
  previewImage: File,
  hasFalKey: boolean
): Promise<string> {
  try {
    if (hasFalKey) {
      fal.config({
        credentials:
          process.env.FAL_KEY?.trim() ||
          process.env.AI_TRYON_API_KEY?.trim() ||
          "",
      });
      return await fal.storage.upload(previewImage);
    }
  } catch (err) {
    console.warn(
      "[try-on] preview upload failed, returning data URL",
      err instanceof Error ? err.message : err
    );
  }
  return fileToDataUrl(previewImage);
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let categoryForUsage: CategoryId | null = null;

  const envProvider =
    process.env.AI_TRYON_PROVIDER?.trim().toLowerCase() || "mock";
  const envRenderMode =
    process.env.TRYON_RENDER_MODE?.trim().toLowerCase() || "auto";
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

    // Optional client-side deterministic preview.
    let previewImage: File | null = null;
    const previewEntry = formData.get("previewImage");
    if (previewEntry instanceof File && previewEntry.size > 0) {
      const err = validateImageFile(previewEntry, "Aperçu rapide");
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      previewImage = previewEntry;
    }

    // Optional inpainting refinement pack (composite + contact-band mask).
    // Sent by the client when the user clicks "Améliorer avec l'IA".
    let inpaintComposite: File | null = null;
    let inpaintMask: File | null = null;
    const compositeEntry = formData.get("compositeImage");
    if (compositeEntry instanceof File && compositeEntry.size > 0) {
      const err = validateImageFile(compositeEntry, "Composite");
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      inpaintComposite = compositeEntry;
    }
    const maskEntry = formData.get("maskImage");
    if (maskEntry instanceof File && maskEntry.size > 0) {
      const err = validateImageFile(maskEntry, "Masque");
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      inpaintMask = maskEntry;
    }
    const useInpaintingRaw = formData.get("useInpainting");
    const useInpaintingRequested =
      typeof useInpaintingRaw === "string" &&
      useInpaintingRaw.toLowerCase() === "true";

    const productImages: File[] = [];
    for (const entry of formData.getAll("productImages")) {
      if (entry instanceof File && entry.size > 0) {
        const err = validateImageFile(entry, "Image produit");
        if (err) return NextResponse.json({ error: err }, { status: 400 });
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
    const productUrls = productUrlsRaw.filter(looksLikeImageUrl);
    const droppedUrls = productUrlsRaw.length - productUrls.length;

    let productCutoutUrls: string[] = [];
    const cutoutRaw = formData.get("productCutoutUrls");
    if (typeof cutoutRaw === "string" && cutoutRaw.trim()) {
      try {
        const parsed: unknown = JSON.parse(cutoutRaw);
        if (Array.isArray(parsed)) {
          productCutoutUrls = parsed.filter(
            (u): u is string =>
              typeof u === "string" && u.startsWith("http")
          );
        }
      } catch {
        // ignore — cutouts are optional
      }
    }
    const productWasCutout = productCutoutUrls.length > 0;

    const productHasAlphaRaw = formData.get("productHasAlpha");
    const productHasAlpha =
      typeof productHasAlphaRaw === "string"
        ? productHasAlphaRaw.toLowerCase() === "true"
        : productWasCutout;

    const productMimeTypeRaw = formData.get("productMimeType");
    const productMimeType =
      typeof productMimeTypeRaw === "string" && productMimeTypeRaw.trim()
        ? productMimeTypeRaw.trim()
        : productWasCutout
          ? "image/png"
          : "image/jpeg";

    const productImageSourceRaw = formData.get("productImageSource");
    const productImageSource: "transparent-upload" | "cutout" | "original" =
      productImageSourceRaw === "transparent-upload" ||
      productImageSourceRaw === "cutout" ||
      productImageSourceRaw === "original"
        ? productImageSourceRaw
        : productWasCutout
          ? "cutout"
          : "original";

    let watchPlacement: WatchPlacementResponse | undefined;
    const watchPlacementRaw = formData.get("watchPlacement");
    if (typeof watchPlacementRaw === "string" && watchPlacementRaw.trim()) {
      try {
        const parsed = JSON.parse(watchPlacementRaw);
        if (parsed && typeof parsed === "object") {
          const p = parsed as Record<string, unknown>;
          if (
            typeof p.x === "number" &&
            typeof p.y === "number" &&
            typeof p.scale === "number" &&
            typeof p.rotation === "number"
          ) {
            watchPlacement = {
              x: p.x,
              y: p.y,
              scale: p.scale,
              rotation: p.rotation,
              curvature:
                typeof p.curvature === "number" ? p.curvature : 0,
              confidence:
                typeof p.confidence === "number" ? p.confidence : 0,
            };
          }
        }
      } catch {
        // ignore malformed placement — non-fatal
      }
    }

    const edgeQualityRaw = formData.get("edgeQuality");
    const edgeQuality =
      typeof edgeQualityRaw === "string" && edgeQualityRaw.trim()
        ? clamp01(parseFloat(edgeQualityRaw))
        : undefined;

    if (productImages.length === 0 && productUrls.length === 0) {
      const reason =
        droppedUrls > 0
          ? "Aucune image produit exploitable. Importez une image ou utilisez un lien produit dont l'image a été détectée."
          : "Veuillez ajouter au moins un article (lien produit ou image).";
      return NextResponse.json(
        {
          error: reason,
          debug: { imageCount: 1, productImageCount: 0 },
        },
        { status: 400 }
      );
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

    const renderModeRequest = (() => {
      const raw = formData.get("renderModeRequest");
      if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (v === "fast" || v === "premium" || v === "auto") return v;
      }
      return undefined;
    })();

    const handJewelryType = (() => {
      const raw = formData.get("handJewelryType");
      if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (v === "ring" || v === "bracelet") return v as HandJewelryType;
      }
      return undefined;
    })();

    const ringFinger = (() => {
      const raw = formData.get("ringFinger");
      if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        if (v === "index" || v === "middle" || v === "ring" || v === "pinky")
          return v as FingerId;
      }
      return undefined;
    })();

    const clientWarnings = parseWarnings(formData.get("warnings") as string);

    // Decide effective render mode.
    const requested =
      renderModeRequest ??
      (envRenderMode === "fast" || envRenderMode === "premium"
        ? envRenderMode
        : "auto");
    const isAccessory = ACCESSORY_CATEGORIES.includes(category);

    // The client triggers inpainting refinement (FLUX Fill) by sending a
    // composite + mask + useInpainting=true. This always takes priority
    // over the fast-overlay path.
    const useInpainting =
      useInpaintingRequested &&
      inpaintComposite !== null &&
      inpaintMask !== null &&
      hasFalKey &&
      envProvider !== "mock";

    const useFast =
      !useInpainting &&
      previewImage !== null &&
      isAccessory &&
      (requested === "fast" || requested === "auto");

    console.info(
      `[try-on] start provider=${envProvider} category=${category} hasFalKey=${hasFalKey} requested=${requested} useFast=${useFast} useInpainting=${useInpainting} productImages=${productImages.length} productUrls=${productUrls.length} productImageSource=${productImageSource} productHasAlpha=${productHasAlpha} productMimeType=${productMimeType}`
    );

    if (useFast && previewImage) {
      // Fast deterministic path — no AI generation cost.
      // If FAL_KEY is available we upload to fal.storage so the result URL
      // is on a CDN (shareable); otherwise we return a data URL.
      const resultUrl = await uploadPreviewToCdn(previewImage, hasFalKey);

      const durationMs = Date.now() - startedAt;
      const renderMode: RenderMode = "fast-overlay";
      const qualityStatus = clientWarnings.some(
        (w) => w.code === "landmarks-missing"
      )
        ? "needs-better-photo"
        : "passed";

      console.info(
        `[try-on] success renderMode=fast-overlay durationMs=${durationMs}`
      );

      trackTryOnUsage({
        merchantId,
        category,
        provider: "fast-overlay",
        model: "canvas",
        mock: false,
        success: true,
        durationMs,
      });

      return NextResponse.json({
        resultUrl,
        previewUrl: resultUrl,
        generatedAt: Date.now(),
        mock: false,
        provider: "fast-overlay",
        model: "canvas",
        category,
        durationMs,
        renderMode,
        qualityStatus,
        warnings: clientWarnings,
        placement: watchPlacement,
        edgeQuality,
        debug: {
          imageCount: 1 + productImages.length + productUrls.length,
          productImageCount: productImages.length + productUrls.length,
          productWasCutout,
          productImageSource,
          productHasAlpha,
          productMimeType,
        },
      });
    }

    // Premium / clothes / fallback path → existing fal pipeline.
    // When transparent cutouts are available, prefer them over the original
    // product images so FLUX Kontext receives clean alpha references.
    const finalProductUrls = productWasCutout
      ? [...productCutoutUrls, ...productUrls]
      : productUrls;
    const finalProductImages = productWasCutout ? [] : productImages;

    const params: TryOnRequest = {
      category,
      userImage,
      productImages: finalProductImages,
      productUrls: finalProductUrls,
      notes,
      merchantId,
      handJewelryType,
      ringFinger,
      renderModeRequest: renderModeRequest,
      ...(useInpainting && inpaintComposite && inpaintMask
        ? {
            inpaintComposite,
            inpaintMask,
          }
        : {}),
    };

    try {
      const result = await generateTryOnImage(params);
      const durationMs = Date.now() - startedAt;

      const debug = {
        ...(result.debug ?? {
          imageCount: 1 + productImages.length + productUrls.length,
          productImageCount: productImages.length + productUrls.length,
        }),
        productWasCutout,
        productImageSource,
        productHasAlpha,
        productMimeType,
      };

      const renderMode: RenderMode =
        result.provider === "mock"
          ? "mock"
          : category === "clothes" && result.model?.includes("fashn")
            ? "specialized-vton"
            : useInpainting
              ? "premium-ai"
              : "premium-ai";

      console.info(
        `[try-on] success provider=${result.provider} model=${result.model} mock=${Boolean(result.mock)} renderMode=${renderMode} durationMs=${durationMs} imageCount=${debug.imageCount} productImageCount=${debug.productImageCount}`
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

      return NextResponse.json({
        ...result,
        durationMs,
        debug,
        renderMode,
        qualityStatus: "passed",
        warnings: clientWarnings,
        placement: watchPlacement,
        edgeQuality,
      });
    } catch (premiumError) {
      // ProviderConfigError must still bubble — that's a misconfiguration,
      // not a quality issue.
      if (premiumError instanceof ProviderConfigError) {
        throw premiumError;
      }
      // If we have a deterministic preview (or the composite that was sent
      // for inpainting), gracefully fall back to it.
      const fallbackPreview = previewImage ?? inpaintComposite;
      if (fallbackPreview) {
        const durationMs = Date.now() - startedAt;
        const safeMessage = safeErrorMessage(premiumError);
        console.warn(
          `[try-on] premium-failed category=${category} durationMs=${durationMs} message=${safeMessage} → returning fast preview`
        );
        const resultUrl = await uploadPreviewToCdn(fallbackPreview, hasFalKey);
        const fallbackWarnings = [
          ...clientWarnings,
          {
            code: "premium-validation-failed",
            message:
              "Rendu IA non validé, aperçu rapide utilisé. Aperçu rapide affiché : le rendu IA premium n'était pas assez fiable.",
          },
        ];
        trackTryOnUsage({
          merchantId,
          category,
          provider: "fast-overlay-fallback",
          model: "canvas",
          mock: false,
          success: true,
          durationMs,
          errorCode:
            premiumError instanceof Error ? premiumError.name : "Error",
        });
        return NextResponse.json({
          resultUrl,
          previewUrl: resultUrl,
          generatedAt: Date.now(),
          mock: false,
          provider: "fast-overlay",
          model: "canvas",
          category,
          durationMs,
          renderMode: "fast-overlay" as RenderMode,
          qualityStatus: "fallback-preview",
          warnings: fallbackWarnings,
          placement: watchPlacement,
          edgeQuality,
          debug: {
            imageCount: 1 + productImages.length + productUrls.length,
            productImageCount: productImages.length + productUrls.length,
            productWasCutout,
            productImageSource,
            productHasAlpha,
            productMimeType,
          },
        });
      }
      throw premiumError;
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const safeMessage = safeErrorMessage(error);

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
        { error: safeMessage, details: safeMessage, provider: envProvider },
        { status: 500 }
      );
    }

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
