import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { isValidCategoryId } from "@/lib/categories";
import { generateTryOnImage, ProviderConfigError } from "@/lib/tryOnService";
import {
  MaskDimensionError,
  MaskRequiredError,
  MaskValidationError,
  OpenAIConfigError,
} from "@/lib/providers/openaiImage";
import {
  compositeLockedProduct,
  isProductLockEnabled,
  ProductLockError,
} from "@/lib/tryon/productLockComposite";
import { autoMaskFromComposite } from "@/lib/tryon/autoMaskFromComposite";
import { checkProductFidelity } from "@/lib/tryon/productFidelityCheck";
import { ACCEPTED_IMAGE_TYPES, MAX_FILE_SIZE } from "@/lib/utils";
import { trackTryOnUsage } from "@/lib/usage";
import type {
  CategoryId,
  FingerId,
  HandJewelryType,
  QualityChecks,
  RenderMode,
  TryOnResponse,
  TryOnWarning,
  WatchPlacementResponse,
} from "@/types";
import type { TryOnRequestWithLockHint } from "@/lib/tryOnService";

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

/**
 * Fetch a remote product cutout URL into a Buffer so providers can use
 * it as a high-fidelity reference. Failures are non-blocking — we log
 * and continue with whatever cutouts succeeded.
 */
async function fetchCutoutBuffers(urls: string[]): Promise<Buffer[]> {
  if (urls.length === 0) return [];
  const out: Buffer[] = [];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        console.warn(
          `[try-on] cutout fetch failed (${r.status}) for ${url}`
        );
        continue;
      }
      out.push(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      console.warn(
        "[try-on] cutout fetch error:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return out;
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
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  // OpenAI handles refinement when its key is set AND the provider is
  // either "openai" explicitly, or "auto" (which prefers OpenAI when
  // available — see lib/tryOnService.ts).
  const openaiActive =
    hasOpenAIKey && (envProvider === "openai" || envProvider === "auto");

  /**
   * Strict "API-only" mode — when on, the route never returns a locally
   * rendered image (fast-overlay, canvas composite, mock) as the *final*
   * result. If OpenAI fails, the response is an error JSON, not a fallback.
   *
   * Triggered by ANY of:
   *  - AI_TRYON_PROVIDER=openai (the explicit choice)
   *  - TRYON_RENDER_MODE=api-only
   *  - DISABLE_LOCAL_RENDER=true
   */
  const apiOnlyMode =
    envProvider === "openai" ||
    envRenderMode === "api-only" ||
    (process.env.DISABLE_LOCAL_RENDER ?? "").trim().toLowerCase() === "true";

  // ── Auto-masked accessory pipeline flags ──────────────────────────
  // The client never provides a mask. For accessories the route either
  // accepts the client-generated composite + mask (preferred) or
  // generates the mask itself from the composite. If both attempts
  // fail, strict mode degrades to the deterministic composite — never
  // a free-generation OpenAI call (which would let the model redraw
  // the product / customer).
  const autoMaskEnabled =
    (process.env.OPENAI_AUTO_MASK ?? "true").trim().toLowerCase() !== "false";
  const accessoryStrictMode =
    (process.env.TRYON_ACCESSORY_STRICT_MODE ?? "true")
      .trim()
      .toLowerCase() !== "false";
  const requireInternalMask =
    (process.env.REQUIRE_INTERNAL_MASK_FOR_ACCESSORIES ?? "true")
      .trim()
      .toLowerCase() !== "false";
  const disableFreeGenForAccessories =
    (process.env.DISABLE_FREE_GENERATION_FOR_ACCESSORIES ?? "true")
      .trim()
      .toLowerCase() !== "false";
  const fallbackToDeterministic =
    (process.env.TRYON_FALLBACK_TO_DETERMINISTIC ?? "true")
      .trim()
      .toLowerCase() !== "false";

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

    // ── Server-side auto-mask (fallback path) ─────────────────────────
    // When the client sent a composite but no mask (e.g. headless test,
    // older client, MediaPipe failed), derive a mask from the diff
    // between the composite and the user image. We only do this for
    // accessories (clothes use a full-edit path that doesn't benefit
    // from a contact-band mask).
    let autoMaskGenerated = false;
    let autoMaskFailed = false;
    if (
      openaiActive &&
      isAccessory &&
      autoMaskEnabled &&
      inpaintComposite !== null &&
      inpaintMask === null
    ) {
      try {
        const compositeBuf = Buffer.from(await inpaintComposite.arrayBuffer());
        const userBuf = Buffer.from(await userImage.arrayBuffer());
        const meta = await sharp(compositeBuf).metadata();
        const tw = meta.width ?? 1024;
        const th = meta.height ?? 1024;
        const auto = await autoMaskFromComposite({
          userImage: userBuf,
          compositeImage: compositeBuf,
          targetWidth: tw,
          targetHeight: th,
        });
        if (auto) {
          inpaintMask = new File(
            [new Uint8Array(auto.buffer)],
            "auto-mask.png",
            { type: "image/png" }
          );
          autoMaskGenerated = true;
          console.info(
            `[try-on] auto-mask generated category=${category} coverage=${auto.coverage.toFixed(3)} dims=${tw}x${th}`
          );
        } else {
          autoMaskFailed = true;
          console.warn(
            `[try-on] auto-mask returned null (silhouette out of range)`
          );
        }
      } catch (err) {
        autoMaskFailed = true;
        console.warn(
          "[try-on] auto-mask generation failed",
          err instanceof Error ? err.message : err
        );
      }
    }

    // The client triggers AI refinement by sending a composite + mask
    // + useInpainting=true. The route honours the request as long as
    // *some* AI provider is configured (OpenAI takes priority when both
    // are set — see lib/tryOnService.ts auto routing).
    const useInpainting =
      useInpaintingRequested &&
      inpaintComposite !== null &&
      inpaintMask !== null &&
      (hasFalKey || hasOpenAIKey) &&
      envProvider !== "mock";

    // The canonical "deterministic preview" is the client composite
    // (PNG, alpha-preserving). We fall back to the legacy JPEG
    // `previewImage` field when the client didn't ship one.
    const finalPreview: File | null = inpaintComposite ?? previewImage;

    // ── Strict mask requirement for OpenAI ────────────────────────
    // When REQUIRE_MASK_FOR_OPENAI=true and OpenAI is the active
    // provider, the user MUST supply a mask. We refuse early with a
    // 400 to make the constraint visible (fidelity is the whole point).
    const requireMaskForOpenAI =
      (process.env.REQUIRE_MASK_FOR_OPENAI?.trim().toLowerCase() ?? "false") ===
      "true";
    if (openaiActive && requireMaskForOpenAI && inpaintMask === null) {
      return NextResponse.json(
        {
          ok: false,
          provider: "openai",
          renderMode: "api-image-edit" as RenderMode,
          category,
          error:
            "A mask is required for OpenAI try-on editing to preserve customer identity and product fidelity.",
        },
        { status: 400 }
      );
    }

    // ── Strict accessory gate ─────────────────────────────────────────
    // For accessories, the *only* sanctioned path is the auto-masked
    // OpenAI edit (composite + mask). If either input is missing AND
    // free generation is disabled, we degrade to the deterministic
    // composite if we have one, otherwise we error out — we never let
    // OpenAI hallucinate the product placement.
    const accessoryInternalArtifactsMissing =
      openaiActive &&
      isAccessory &&
      requireInternalMask &&
      (inpaintComposite === null || inpaintMask === null);
    if (
      accessoryInternalArtifactsMissing &&
      accessoryStrictMode &&
      disableFreeGenForAccessories
    ) {
      if (fallbackToDeterministic && finalPreview) {
        const resultUrl = await uploadPreviewToCdn(finalPreview, hasFalKey);
        const durationMs = Date.now() - startedAt;
        console.warn(
          `[try-on] strict-accessory-no-mask category=${category} → deterministic fallback`
        );
        trackTryOnUsage({
          merchantId,
          category,
          provider: "fast-overlay-fallback",
          model: "canvas",
          mock: false,
          success: true,
          durationMs,
        });
        return NextResponse.json({
          ok: true,
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
          warnings: [
            ...clientWarnings,
            {
              code: "auto_mask_failed_fallback_used",
              message:
                "Auto mask unavailable — deterministic composite returned. The customer never has to provide a mask.",
            },
          ],
          placement: watchPlacement,
          edgeQuality,
          debug: {
            imageCount: 1 + productImages.length + productUrls.length,
            productImageCount: productImages.length + productUrls.length,
            productWasCutout,
            productImageSource,
            productHasAlpha,
            productMimeType,
            usedOpenAI: false,
            usedFal: false,
            usedLocalRenderer: true,
            maskUsed: false,
            autoMaskGenerated: false,
            compositeUsed: false,
            productLockCandidate: false,
            productLockApplied: false,
            fallbackUsed: true,
          },
        });
      }
      return NextResponse.json(
        {
          ok: false,
          provider: "openai",
          renderMode: "api-image-edit" as RenderMode,
          category,
          error:
            "Internal composite + mask are required for accessory try-on. The auto-masking pipeline could not produce them.",
        },
        { status: 400 }
      );
    }
    void accessoryStrictMode;

    // If the auto-mask attempted and failed but we still got here (free
    // gen not disabled), surface a soft warning so dashboards know.
    void autoMaskFailed;

    // In API-only mode every category MUST go through OpenAI — no
    // fast-overlay path, no canvas-as-final-result. Local renderers may
    // still produce the optional composite/mask we forward to OpenAI
    // (that's an *input*, not a *result*). A manual mask alone (no
    // composite) also disables fast-overlay because the user is asking
    // for guided editing.
    const useFast =
      !apiOnlyMode &&
      !useInpainting &&
      inpaintMask === null &&
      finalPreview !== null &&
      isAccessory &&
      requested === "fast";

    // ── Validate mask dimensions vs base image ────────────────────────
    // Per spec: "if mask is present but dimensions mismatch base image,
    // reject with validation error". Cheap up-front check via sharp.
    if (inpaintMask) {
      try {
        const baseDimsSrc = inpaintComposite ?? userImage;
        const [baseMeta, maskMeta] = await Promise.all([
          sharp(Buffer.from(await baseDimsSrc.arrayBuffer())).metadata(),
          sharp(Buffer.from(await inpaintMask.arrayBuffer())).metadata(),
        ]);
        if (
          baseMeta.width &&
          baseMeta.height &&
          maskMeta.width &&
          maskMeta.height &&
          (baseMeta.width !== maskMeta.width ||
            baseMeta.height !== maskMeta.height)
        ) {
          return NextResponse.json(
            {
              ok: false,
              provider: openaiActive ? "openai" : envProvider,
              renderMode: openaiActive ? "api-image-edit" : "premium-ai",
              category,
              error: `Mask dimensions do not match the base image (base ${baseMeta.width}x${baseMeta.height} vs mask ${maskMeta.width}x${maskMeta.height}).`,
            },
            { status: 400 }
          );
        }
      } catch (validationErr) {
        const msg = safeErrorMessage(validationErr);
        return NextResponse.json(
          {
            ok: false,
            provider: openaiActive ? "openai" : envProvider,
            renderMode: openaiActive ? "api-image-edit" : "premium-ai",
            category,
            error: `Mask validation failed: ${msg}`,
          },
          { status: 400 }
        );
      }
    }

    console.info(
      `[try-on] start provider=${envProvider} category=${category} apiOnlyMode=${apiOnlyMode} hasFalKey=${hasFalKey} hasOpenAIKey=${hasOpenAIKey} openaiActive=${openaiActive} requested=${requested} useFast=${useFast} useInpainting=${useInpainting} productImages=${productImages.length} productUrls=${productUrls.length} productImageSource=${productImageSource} productHasAlpha=${productHasAlpha} productMimeType=${productMimeType}`
    );

    if (useFast && finalPreview) {
      // Fast deterministic path — no AI generation cost.
      // If FAL_KEY is available we upload to fal.storage so the result URL
      // is on a CDN (shareable); otherwise we return a data URL.
      const resultUrl = await uploadPreviewToCdn(finalPreview, hasFalKey);

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
        ok: true,
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
          usedOpenAI: false,
          usedFal: false,
          usedLocalRenderer: true,
          maskUsed: false,
          autoMaskGenerated: false,
          compositeUsed: false,
          productLockCandidate: false,
          productLockApplied: false,
          fallbackUsed: false,
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

    // Pre-fetch transparent product cutouts so OpenAI can use them as
    // high-fidelity references alongside the originals.
    const productCutoutBuffers = openaiActive
      ? await fetchCutoutBuffers(productCutoutUrls)
      : [];

    // ── Decide whether the product-lock pipeline can apply ────────────
    // Lock requires:
    //   - OpenAI provider active
    //   - the env flag is on (OPENAI_PRODUCT_LOCK ≠ false)
    //   - this is an accessory category (clothes deform, lock breaks fit)
    //   - we have BOTH a composite (so we know where the product is) AND
    //     a mask (so the AI only edits the contact band).
    const productLockEnabled = isProductLockEnabled();
    const productLockCandidate =
      openaiActive &&
      productLockEnabled &&
      isAccessory &&
      inpaintComposite !== null &&
      inpaintMask !== null;

    // Forward the mask whenever it's present — OpenAI image edit can
    // accept a mask without a composite. The composite is forwarded when:
    //   - the client explicitly asks for inpainting refinement, OR
    //   - the product-lock pipeline is engaged (which needs both layers
    //     to derive the silhouette server-side).
    const forwardComposite =
      (useInpainting || productLockCandidate) &&
      inpaintComposite !== null &&
      inpaintMask !== null;

    // Accessories with a composite + mask (whether client- or auto-
    // generated) get the strict integration-only prompt instead of the
    // looser placement leads. Watches additionally route to the
    // ultra-strict watch prompt.
    const autoMaskedAccessory =
      openaiActive &&
      isAccessory &&
      inpaintComposite !== null &&
      inpaintMask !== null;

    const params: TryOnRequestWithLockHint = {
      category,
      userImage,
      productImages: finalProductImages,
      productUrls: finalProductUrls,
      productCutoutBuffers,
      notes,
      merchantId,
      handJewelryType,
      ringFinger,
      renderModeRequest: renderModeRequest,
      productLocked: productLockCandidate,
      autoMaskedAccessory,
      ...(forwardComposite && inpaintComposite && inpaintMask
        ? { inpaintComposite, inpaintMask }
        : inpaintMask
          ? { inpaintMask }
          : {}),
    };

    // Surface a friendly warning when no mask is provided but the
    // OpenAI path is active — the spec mentions this explicitly.
    const noMaskWarning =
      openaiActive && !inpaintMask
        ? [
            {
              code: "openai-no-mask",
              message:
                "No mask provided. The edit may be less constrained.",
            },
          ]
        : [];
    const allClientWarnings = [...clientWarnings, ...noMaskWarning];

    try {
      const result = await generateTryOnImage(params);
      const durationMs = Date.now() - startedAt;

      const usedOpenAI = result.provider === "openai";
      const usedFal = result.provider === "fal";
      const openaiMeta =
        (
          result as TryOnResponse & {
            openaiMeta?: import("@/lib/providers/openaiImage").OpenAIImageMeta;
          }
        ).openaiMeta ?? null;

      // ── Product-lock post-processing ────────────────────────────
      // For accessory categories with composite+mask, re-stamp the
      // original product PNG on top of the AI output. The function
      // returns `productLocked=false` (with a skip reason) when the
      // diff-derived silhouette is unusable — that's a soft warning,
      // not an error. A hard ProductLockError aborts the request:
      // we never want to silently ship an unlocked accessory result
      // when the operator opted into the lock pipeline.
      let finalResultUrl = result.resultUrl;
      let lockedProductLocked = false;
      let productFidelityMode: QualityChecks["productFidelityMode"] =
        usedOpenAI ? "ai-only" : undefined;
      let productSilhouetteRatio: number | undefined;
      const lockWarnings: TryOnWarning[] = [];

      if (
        usedOpenAI &&
        productLockCandidate &&
        openaiMeta &&
        openaiMeta.compositeAtTargetSize
      ) {
        try {
          const lockResult = await compositeLockedProduct({
            baseImageAfterAI: openaiMeta.resultBuffer,
            compositeBeforeAI: openaiMeta.compositeAtTargetSize,
            userBaseImage: openaiMeta.baseAtTargetSize,
            category,
          });
          lockedProductLocked = lockResult.productLocked;
          productFidelityMode = lockResult.productFidelityMode;
          productSilhouetteRatio = lockResult.silhouetteRatio;
          if (lockResult.productLocked) {
            finalResultUrl = `data:image/png;base64,${lockResult.buffer.toString(
              "base64"
            )}`;
          } else if (lockResult.skipReason) {
            lockWarnings.push({
              code: "product-lock-skipped",
              message: `Product lock not applied: ${lockResult.skipReason}`,
            });
          }
        } catch (lockErr) {
          // Hard failure of the lock pipeline. The spec says: do NOT
          // silently return a bad result. Surface a clear 502.
          console.error(
            `[try-on] product-lock-failed category=${category} message=${
              lockErr instanceof Error ? lockErr.message : lockErr
            }`
          );
          if (lockErr instanceof ProductLockError) {
            return NextResponse.json(
              {
                ok: false,
                provider: "openai",
                renderMode: "api-image-edit-product-lock" as RenderMode,
                category,
                error: "Product fidelity lock failed.",
                details: lockErr.message,
              },
              { status: 502 }
            );
          }
          throw lockErr;
        }
      } else if (usedOpenAI && category === "clothes") {
        productFidelityMode = "ai-only";
        lockWarnings.push({
          code: "clothes-fidelity-warning",
          message:
            "Clothing try-on may slightly reinterpret garment details. Use high-quality product images for better fidelity.",
        });
      } else if (
        usedOpenAI &&
        productLockEnabled &&
        isAccessory &&
        !productLockCandidate
      ) {
        productFidelityMode = "ai-only";
        lockWarnings.push({
          code: "product-lock-unavailable",
          message:
            "Product lock unavailable: a composite + mask are required to enforce product fidelity.",
        });
      }

      // ── Product fidelity check (post-generation) ────────────────────
      // For accessories with a composite, compare the dominant colour
      // and silhouette area of the product region. If the AI drifted
      // (e.g. black watch → silver watch, or product completely
      // displaced), mark `qualityCheckFailed` and — when allowed —
      // return the deterministic composite as the final result.
      let qualityCheckFailed = false;
      let qualityCheckFallbackApplied = false;
      if (
        usedOpenAI &&
        isAccessory &&
        openaiMeta &&
        openaiMeta.compositeAtTargetSize
      ) {
        try {
          const fidelity = await checkProductFidelity({
            aiResult: openaiMeta.resultBuffer,
            composite: openaiMeta.compositeAtTargetSize,
            userBase: openaiMeta.baseAtTargetSize,
          });
          if (!fidelity.passed) {
            qualityCheckFailed = true;
            console.warn(
              `[try-on] product-fidelity-failed category=${category} colorDelta=${fidelity.colorDelta.toFixed(
                1
              )} silhouetteOk=${fidelity.silhouetteRatioOk} colorOk=${fidelity.colorOk}`
            );
            lockWarnings.push({
              code: "product-fidelity-check-failed",
              message: `Product fidelity check failed (color Δ=${Math.round(
                fidelity.colorDelta
              )}). The AI may have altered the product.`,
            });
            // Strict fallback: hand the customer the deterministic
            // composite so the product remains pixel-perfect, even
            // though the contact shadows are less refined.
            if (
              fallbackToDeterministic &&
              !lockedProductLocked &&
              openaiMeta.compositeAtTargetSize
            ) {
              finalResultUrl = `data:image/png;base64,${openaiMeta.compositeAtTargetSize.toString(
                "base64"
              )}`;
              qualityCheckFallbackApplied = true;
            }
          }
        } catch (err) {
          console.warn(
            "[try-on] product fidelity check threw",
            err instanceof Error ? err.message : err
          );
        }
      }

      const inputDimensions = openaiMeta
        ? {
            width:
              openaiMeta.size === "1024x1024"
                ? 1024
                : openaiMeta.size === "1024x1536"
                  ? 1024
                  : 1536,
            height:
              openaiMeta.size === "1024x1024"
                ? 1024
                : openaiMeta.size === "1024x1536"
                  ? 1536
                  : 1024,
          }
        : undefined;

      const debug = {
        ...(result.debug ?? {
          imageCount: 1 + productImages.length + productUrls.length,
          productImageCount: productImages.length + productUrls.length,
        }),
        productWasCutout,
        productImageSource,
        productHasAlpha,
        productMimeType,
        usedOpenAI,
        usedFal,
        // Final image came from a hosted AI provider, never from a local
        // renderer in the success path.
        usedLocalRenderer: qualityCheckFallbackApplied,
        maskUsed: usedOpenAI ? Boolean(openaiMeta?.maskUsed) : useInpainting,
        productLocked: lockedProductLocked,
        autoMaskGenerated,
        compositeUsed: Boolean(openaiMeta?.compositeUsedAsBase),
        productLockCandidate,
        productLockApplied: lockedProductLocked,
        fallbackUsed: qualityCheckFallbackApplied,
        inputDimensions,
        productAlphaDetected: Boolean(openaiMeta?.productHasAlpha),
        qualityCheckFailed,
      };

      const renderMode: RenderMode = qualityCheckFallbackApplied
        ? "fast-overlay"
        : usedOpenAI
          ? lockedProductLocked
            ? "api-image-edit-product-lock"
            : "api-image-edit"
          : result.provider === "mock"
            ? "mock"
            : category === "clothes" && result.model?.includes("fashn")
              ? "specialized-vton"
              : "premium-ai";

      // ── Strict customer preservation gate ──────────────────────────
      // The spec says: if the AI changed too much outside the mask, we
      // must not silently accept it. In API-only mode we surface a 502
      // with a tightening hint. Otherwise we degrade to a warning.
      const outsideOk = openaiMeta?.qualityChecks.outsideMaskPreserved ?? true;
      const customerStrictMode =
        (process.env.OPENAI_PRESERVE_CUSTOMER_STRICT ?? "true")
          .trim()
          .toLowerCase() !== "false";
      if (
        usedOpenAI &&
        customerStrictMode &&
        !outsideOk &&
        apiOnlyMode &&
        Boolean(openaiMeta?.maskUsed)
      ) {
        console.warn(
          `[try-on] strict-preservation-failed category=${category} score=${openaiMeta?.qualityChecks.outsideMaskChangeScore.toFixed(
            3
          )}`
        );
        return NextResponse.json(
          {
            ok: false,
            provider: "openai",
            renderMode,
            category,
            error:
              "The edit changed too much of the customer image. Use a tighter mask.",
            qualityChecks: {
              ...openaiMeta?.qualityChecks,
              productLocked: lockedProductLocked,
              productFidelityMode,
              productSilhouetteRatio,
            },
          },
          { status: 502 }
        );
      }

      // Merge the provider's own warnings (mask validation, low-res
      // product, outside-mask drift, etc.) with the client warnings.
      const mergedWarnings: TryOnWarning[] = [
        ...allClientWarnings,
        ...(openaiMeta?.warnings ?? []),
        ...lockWarnings,
      ];

      const mergedQualityChecks: QualityChecks | undefined = openaiMeta
        ? {
            ...openaiMeta.qualityChecks,
            productLocked: lockedProductLocked,
            productFidelityMode,
            productSilhouetteRatio,
          }
        : undefined;

      console.info(
        `[try-on] success provider=${result.provider} model=${result.model} mock=${Boolean(result.mock)} renderMode=${renderMode} maskUsed=${debug.maskUsed} productLocked=${lockedProductLocked} productFidelityMode=${productFidelityMode ?? "n/a"} usedLocalRenderer=false durationMs=${durationMs} imageCount=${debug.imageCount} productImageCount=${debug.productImageCount} ${
          openaiMeta
            ? `outsideMaskScore=${openaiMeta.qualityChecks.outsideMaskChangeScore.toFixed(3)} outsideMaskPreserved=${openaiMeta.qualityChecks.outsideMaskPreserved}`
            : ""
        }`
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
        ok: true,
        resultUrl: finalResultUrl,
        previewUrl: result.previewUrl,
        generatedAt: result.generatedAt,
        mock: result.mock,
        provider: result.provider,
        model: result.model,
        category: result.category ?? category,
        durationMs,
        debug,
        renderMode,
        qualityStatus: "passed",
        warnings: mergedWarnings,
        placement: watchPlacement,
        edgeQuality,
        // OpenAI fidelity surface
        qualityChecks: mergedQualityChecks,
        preserveCustomerStrict: usedOpenAI && customerStrictMode,
        preserveProductStrict: usedOpenAI,
        productLocked: lockedProductLocked,
      });
    } catch (premiumError) {
      // ProviderConfigError must still bubble — that's a misconfiguration,
      // not a quality issue.
      if (premiumError instanceof ProviderConfigError) {
        throw premiumError;
      }
      // OpenAI mask requirement / dimension / validation errors are
      // user-facing 400s.
      if (
        premiumError instanceof MaskRequiredError ||
        premiumError instanceof MaskDimensionError ||
        premiumError instanceof MaskValidationError
      ) {
        return NextResponse.json(
          {
            ok: false,
            provider: "openai",
            renderMode: "api-image-edit" as RenderMode,
            category,
            error: premiumError.message,
          },
          { status: 400 }
        );
      }
      // OpenAI config errors are configuration issues.
      if (premiumError instanceof OpenAIConfigError) {
        throw new ProviderConfigError(premiumError.message);
      }

      const safeMessage = safeErrorMessage(premiumError);
      const durationMs = Date.now() - startedAt;

      // ── API-only mode → strict error, NEVER a local render ────────
      if (apiOnlyMode) {
        console.error(
          `[try-on] api-only-failed category=${category} durationMs=${durationMs} message=${safeMessage}`
        );
        trackTryOnUsage({
          merchantId,
          category,
          provider: openaiActive ? "openai" : envProvider,
          model: "unknown",
          mock: false,
          success: false,
          durationMs,
          errorCode:
            premiumError instanceof Error ? premiumError.name : "Error",
        });
        return NextResponse.json(
          {
            ok: false,
            provider: openaiActive ? "openai" : envProvider,
            renderMode: "api-image-edit" as RenderMode,
            category,
            error:
              "OpenAI image edit failed. No local renderer fallback was used because API-only mode is enabled.",
            details: safeMessage,
          },
          { status: 502 }
        );
      }

      // ── Legacy graceful fallback (non-api-only, fal-style providers) ─
      const fallbackPreview = finalPreview;
      if (fallbackPreview) {
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
          ok: true,
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
            usedOpenAI: false,
            usedFal: false,
            usedLocalRenderer: true,
            maskUsed: false,
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
        `[try-on] config-error provider=${envProvider} hasFalKey=${hasFalKey} hasOpenAIKey=${hasOpenAIKey} durationMs=${durationMs} message=${safeMessage}`
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
          ok: false,
          provider: envProvider,
          renderMode: openaiActive
            ? ("api-image-edit" as RenderMode)
            : ("premium-ai" as RenderMode),
          category: categoryForUsage,
          error: safeMessage,
          details: safeMessage,
        },
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
          ok: false,
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
    return NextResponse.json(
      { ok: false, error: safeMessage },
      { status: 500 }
    );
  }
}
