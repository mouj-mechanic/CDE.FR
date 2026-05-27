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
import {
  autoMaskFromComposite,
  createRetryMaskForCustomerPreservation,
} from "@/lib/tryon/autoMaskFromComposite";
import { checkProductFidelity } from "@/lib/tryon/productFidelityCheck";
import { detectDuplicateProductPlacement } from "@/lib/tryon/duplicateDetection";
import {
  composeLockedAccessoryFinal,
  detectGhostProductOutsideExpectedSilhouette,
} from "@/lib/tryon/composeLockedFinal";
import { checkWatchMaskSafety } from "@/lib/tryon/maskSafetyCheck";
import {
  checkHandArtifactDamage,
  checkVisibleMaskArtifacts,
} from "@/lib/tryon/handArtifactCheck";
import { ACCEPTED_IMAGE_TYPES, MAX_FILE_SIZE } from "@/lib/utils";
import { trackTryOnUsage } from "@/lib/usage";
import type {
  CategoryId,
  FingerId,
  HandJewelryType,
  QualityChecks,
  QualityStatus,
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
   * Watch-specific kill switch. When `WATCH_USE_OPENAI_CONTACT_BLEND`
   * is `false`, the route skips OpenAI entirely for watch/hand-jewelry
   * runs and serves the deterministic composite directly. Use this in
   * production to immediately stop broken renders from reaching the
   * customer while we tune the mask + safety gates.
   *
   *  Default flipped to `false` alongside Watch Renderer V3 — the V3
   *  pipeline ships as a deterministic single-layer composite. OpenAI
   *  re-enters the picture only when the operator explicitly opts in
   *  with `WATCH_USE_OPENAI_CONTACT_BLEND=true`, which we will only do
   *  once the V3 rendering quality is reliably superior to AI hand
   *  reconstruction.
   */
  const watchUseOpenAIBlendRaw =
    process.env.WATCH_USE_OPENAI_CONTACT_BLEND?.trim().toLowerCase();
  const watchUseOpenAIBlend = watchUseOpenAIBlendRaw === "true";

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

  /**
   * Debug-only escape hatch: when on, the route returns RAW technical
   * errors (502 / 400 with mask-coverage / preservation-score messages)
   * instead of the customer-friendly deterministic fallback. Use ONLY
   * in CI / staging — production must stay at `false` so end users
   * never see "Nous n'avons pas pu valider ce rendu …".
   *
   *  Why this exists: the previous implementation tied "strict errors"
   *  to `apiOnlyMode`, which production needs (to force OpenAI as the
   *  final provider). The two concerns are now decoupled:
   *
   *    - `apiOnlyMode`              → "use OpenAI exclusively"
   *    - `TRYON_DEBUG_STRICT_ERRORS` → "surface technical errors"
   */
  const debugStrictErrors =
    (process.env.TRYON_DEBUG_STRICT_ERRORS ?? "false")
      .trim()
      .toLowerCase() === "true";

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
    // ── Watch V3 kill switch short-circuit ────────────────────────
    // When the operator disabled OpenAI contact blending for
    // watches/hand-jewelry (WATCH_USE_OPENAI_CONTACT_BLEND=false),
    // the V3 composite IS the final output. Generating an auto-mask
    // is wasted work and worse: a failing mask-safety check below
    // would NULL OUT the composite too (anti-OpenAI-misfire guard),
    // leaving `finalPreview === null` and triggering the strict-
    // accessory 400 ("Internal composite + mask are required…").
    // Skip both auto-mask and mask-safety entirely on this path.
    const skipAutoMaskForWatchKillSwitch =
      !watchUseOpenAIBlend &&
      (category === "watch" || category === "hand-jewelry");
    if (
      openaiActive &&
      isAccessory &&
      autoMaskEnabled &&
      !skipAutoMaskForWatchKillSwitch &&
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
          category,
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

    // ── Pre-flight mask safety check ──────────────────────────────
    // Hard stop BEFORE OpenAI is called if the mask is inverted,
    // covers too much of the hand, or sits in the wrong spot.
    // Catches the classic "ring widened until it ate the fingers"
    // failure mode that produces destroyed-hand outputs. The route
    // then falls back to the deterministic composite instead — the
    // customer never sees a broken result.
    let maskSafetyReasons: string[] = [];
    let maskSafetyStats: {
      editableEnergyRatio: number;
      bboxRatio: number;
      outsideBBoxRatio: number;
      touchesBorder: boolean;
      inverted: boolean;
    } | null = null;
    if (
      openaiActive &&
      (category === "watch" || category === "hand-jewelry") &&
      inpaintMask !== null
    ) {
      try {
        const maskBuf = Buffer.from(await inpaintMask.arrayBuffer());
        const safety = await checkWatchMaskSafety({
          mask: maskBuf,
          category,
        });
        maskSafetyStats = {
          editableEnergyRatio: safety.stats.editableEnergyRatio,
          bboxRatio: safety.stats.bbox.ratio,
          outsideBBoxRatio: safety.stats.outsideBBoxRatio,
          touchesBorder: safety.stats.touchesBorder,
          inverted: safety.stats.inverted,
        };
        if (!safety.ok) {
          maskSafetyReasons = safety.reasons;
          console.warn(
            `[try-on] mask-safety-failed category=${category} reasons=${safety.reasons.join(
              "|"
            )} stats=${JSON.stringify(maskSafetyStats)}`
          );
          // Drop the mask + composite so the route degrades to the
          // deterministic preview path further down (or to the strict
          // accessory gate when DISABLE_FREE_GENERATION_FOR_ACCESSORIES
          // is on). We do NOT throw — the customer gets the safe
          // deterministic fallback.
          inpaintMask = null;
          inpaintComposite = null;
        }
      } catch (err) {
        console.warn(
          "[try-on] mask safety check threw",
          err instanceof Error ? err.message : err
        );
      }
    }

    // The client triggers AI refinement by sending a composite + mask
    // + useInpainting=true. The route honours the request as long as
    // *some* AI provider is configured (OpenAI takes priority when both
    // are set — see lib/tryOnService.ts auto routing).
    // Watch / hand-jewelry kill-switch. When the operator disables
    // OpenAI contact-band blending we drop AI refinement before it
    // can run — the route then naturally serves the deterministic
    // composite. We DO NOT throw: the customer keeps getting a
    // perfectly fine deterministic preview, just without the IA
    // shadows.
    const watchKillSwitchEngaged =
      !watchUseOpenAIBlend &&
      (category === "watch" || category === "hand-jewelry");

    const useInpainting =
      useInpaintingRequested &&
      inpaintComposite !== null &&
      inpaintMask !== null &&
      (hasFalKey || hasOpenAIKey) &&
      envProvider !== "mock" &&
      !watchKillSwitchEngaged;

    if (watchKillSwitchEngaged) {
      console.info(
        `[try-on] watch killswitch ENGAGED (WATCH_USE_OPENAI_CONTACT_BLEND=false) — ` +
          `serving deterministic composite for category=${category}`
      );
    }

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
    // The watch V3 kill switch path INTENTIONALLY ships no mask —
    // the deterministic composite IS the final output. Exempting it
    // from the strict gate lets the route serve the V3 result via
    // the normal "no AI used" return path further down (instead of
    // mislabelling it as a fallback in the JSON response).
    if (
      accessoryInternalArtifactsMissing &&
      accessoryStrictMode &&
      disableFreeGenForAccessories &&
      !skipAutoMaskForWatchKillSwitch
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

    // ── Watch V3 kill switch — short-circuit return ──────────────────
    // When the operator disabled OpenAI contact-band blending for
    // watches/hand-jewelry, the V3 composite IS the final output.
    // We MUST short-circuit BEFORE any AI provider call to avoid
    //   - wasted spend on a result we'd discard anyway, and
    //   - "Internal composite + mask are required" 400s that come
    //     from downstream paths assuming an AI step.
    if (
      skipAutoMaskForWatchKillSwitch &&
      finalPreview !== null
    ) {
      const resultUrl = await uploadPreviewToCdn(finalPreview, hasFalKey);
      const durationMs = Date.now() - startedAt;
      const qualityStatus = clientWarnings.some(
        (w) => w.code === "landmarks-missing"
      )
        ? "needs-better-photo"
        : "passed";
      trackTryOnUsage({
        merchantId,
        category,
        provider: "fast-overlay",
        model: "canvas-v3",
        mock: false,
        success: true,
        durationMs,
      });
      console.info(
        `[try-on] watch-v3-killswitch direct-return category=${category} durationMs=${durationMs}`
      );
      return NextResponse.json({
        ok: true,
        resultUrl,
        previewUrl: resultUrl,
        generatedAt: Date.now(),
        mock: false,
        provider: "fast-overlay",
        model: "canvas-v3",
        category,
        durationMs,
        renderMode: "fast-overlay" as RenderMode,
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
          compositeUsed: true,
          productLockCandidate: false,
          productLockApplied: false,
          watchKillSwitchEngaged: true,
        },
      });
    }

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

    // ── OpenAI retry loop ─────────────────────────────────────────
    // Up to 3 attempts. Each attempt is gated by a distinct flag so
    // every "retry reason" is consumed once at most:
    //
    //  1. Initial pass.
    //  2. (catch) MaskValidationError code="mask-too-small" →
    //     regenerate with the progressive auto-mask (wider ring).
    //  3. (gate) Customer-preservation failed →
    //     re-run with a SAFER mask (tighter ring, no contact patch).
    //
    //  If neither retry runs, the loop simply executes once. The
    //  loop body's success path returns directly; the catch path
    //  either returns or `continue retryLoop`s.
    let maskTooSmallRetried = false;
    let customerPreservationRetried = false;
    let lastMaskTooSmallRetryDebug:
      | { coverage: number; outerDilatePx?: number; featherPx?: number }
      | null = null;
    let lastCustomerPreservationRetryDebug:
      | { coverage: number; outerDilatePx?: number; featherPx?: number }
      | null = null;

    retryLoop: for (let __attempt = 0; __attempt < 3; __attempt++) {
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

      // ── Product fidelity & duplication gates (post-generation) ─────
      // For accessories with a composite, we run two independent
      // checks:
      //   1. `checkProductFidelity` — colour + silhouette area drift,
      //      with per-category thresholds (watch is the tightest).
      //   2. `detectDuplicateProductPlacement` — connected-components
      //      flood-fill on the silhouette to count *separate* product
      //      regions. This catches "two watches in the result" cases
      //      that a simple area ratio misses.
      //
      // Each named gate (duplicateWatchDetected, watchPlacementValid,
      // watchScaleValid, watchFidelityValid, customerPreservationValid,
      // maskArtifactFree) is exposed in `debug.gates` so the frontend
      // and QA dashboards can show clear failure reasons.
      let qualityCheckFailed = false;
      let qualityCheckFallbackApplied = false;
      let antiGhostApplied = false;
      const failureReasons: string[] = [];
      const gates: Record<string, boolean> = {
        duplicateWatchDetected: false,
        ghostProductDetected: false,
        watchFidelityValid: true,
        watchScaleValid: true,
        customerPreservationValid: true,
        maskArtifactFree: true,
        noBlackBars: true,
      };
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
            category,
          });

          // Connected-components duplication detection.
          const dup = await detectDuplicateProductPlacement({
            aiResult: openaiMeta.resultBuffer,
            userBase: openaiMeta.baseAtTargetSize,
            expectedSilhouetteRatio: fidelity.compositeSilhouetteRatio,
            category,
          });

          // Ghost detection — pixels the AI changed *outside* the
          // expected silhouette. Catches "second watch on the other
          // wrist" cases that the connected-components detector
          // sometimes lets through (when the ghost is faint).
          const ghost = await detectGhostProductOutsideExpectedSilhouette({
            userBase: openaiMeta.baseAtTargetSize,
            deterministicComposite: openaiMeta.compositeAtTargetSize,
            aiResult: openaiMeta.resultBuffer,
          });

          gates.duplicateWatchDetected = dup.duplicateDetected;
          gates.ghostProductDetected = ghost.ghostDetected;
          gates.watchFidelityValid = fidelity.colorOk;
          gates.watchScaleValid = fidelity.silhouetteRatioOk;
          // `blackBarsRemoved` in debug tells QA whether aspect restore
          // cropped letterbox bars. The final buffer is always cropped
          // when bars were detected, so we mark the gate as passed.
          gates.noBlackBars = true;

          // ── Mandatory locked composition for watches / hand-jewelry ─
          // Wrist accessories are the highest-risk category for
          // OpenAI hallucinations: the model can pixelate fingers,
          // alter nails, paint mask outlines, or insert ghost watches.
          // We therefore ALWAYS rebuild the final image via the
          // three-source mux (product core ← deterministic composite,
          // contact ring ← AI, everything else ← user photo) —
          // regardless of whether the ghost / duplicate detector
          // already flagged a problem. The mux acts as a strict
          // safety net: even if the AI did something subtly wrong on
          // a finger, those pixels are simply discarded.
          //
          // For glasses / headwear we keep the old "only on ghost or
          // duplicate" behaviour because facial features need the AI
          // to blend more aggressively.
          const requiresLockedCompose =
            category === "watch" || category === "hand-jewelry";
          const needsAntiGhost = ghost.ghostDetected || dup.duplicateDetected;
          if (
            (needsAntiGhost || requiresLockedCompose) &&
            fallbackToDeterministic
          ) {
            try {
              const muxed = await composeLockedAccessoryFinal({
                userBase: openaiMeta.baseAtTargetSize,
                deterministicComposite: openaiMeta.compositeAtTargetSize,
                aiResult: openaiMeta.resultBuffer,
                category,
                // Tight contact ring for watches: 12 px wide. Anything
                // outside the ring must come from the user base — that
                // protects fingers, nails, thumb, background.
                contactBandPx: requiresLockedCompose ? 12 : 16,
              });
              if (muxed.applied) {
                finalResultUrl = `data:image/png;base64,${muxed.buffer.toString(
                  "base64"
                )}`;
                antiGhostApplied = true;
                lockWarnings.push({
                  code: needsAntiGhost
                    ? "anti-ghost-applied"
                    : "locked-compose-applied",
                  message: needsAntiGhost
                    ? "The AI drew an extra product instance — re-composed using the deterministic product core."
                    : "Final image rebuilt from locked composite + AI contact band. Customer pixels (fingers, nails, background) preserved 1:1.",
                });
              } else if (
                requiresLockedCompose &&
                openaiMeta.compositeAtTargetSize
              ) {
                // ── HARD FALLBACK — silhouette derivation failed ────
                // The locked compose is the ONLY guarantee that finger
                // / nail / background pixels stay untouched. When it
                // can't apply (rare: product not visible enough to be
                // segmented from the user diff), we are NOT allowed
                // to ship the AI / product-lock output for a watch —
                // that's exactly the "destroyed hand" failure mode.
                // Fall back to the deterministic composite instead.
                finalResultUrl = `data:image/png;base64,${openaiMeta.compositeAtTargetSize.toString(
                  "base64"
                )}`;
                qualityCheckFallbackApplied = true;
                qualityCheckFailed = true;
                failureReasons.push("locked_compose_unable_to_apply");
                lockWarnings.push({
                  code: "locked-compose-fallback",
                  message:
                    "Could not derive the product silhouette safely — deterministic composite used to preserve the customer's hand.",
                });
                console.warn(
                  `[try-on] locked-compose-unable-to-apply category=${category} reason="${muxed.skipReason}" → deterministic fallback`
                );
              }
            } catch (err) {
              console.warn(
                "[try-on] locked compose failed",
                err instanceof Error ? err.message : err
              );
              // Same hard-fallback policy on exception for watches.
              if (
                requiresLockedCompose &&
                openaiMeta.compositeAtTargetSize
              ) {
                finalResultUrl = `data:image/png;base64,${openaiMeta.compositeAtTargetSize.toString(
                  "base64"
                )}`;
                qualityCheckFallbackApplied = true;
                qualityCheckFailed = true;
                failureReasons.push("locked_compose_threw");
                lockWarnings.push({
                  code: "locked-compose-fallback",
                  message:
                    "Safety compositor failed — deterministic composite used to preserve the customer's hand.",
                });
              }
            }
          } else if (requiresLockedCompose && !fallbackToDeterministic) {
            // Operators with TRYON_FALLBACK_TO_DETERMINISTIC=false still
            // need protection on watches. Surface a debug warning so
            // operators understand the safety net is OFF.
            console.warn(
              `[try-on] WARNING category=${category} runs without locked compose because TRYON_FALLBACK_TO_DETERMINISTIC=false`
            );
          }

          // ── Post-composition hand artefact gate ────────────────────
          // We re-decode whichever final image we currently have
          // (post product-lock + post anti-ghost mux) and verify the
          // customer's hand / background was preserved. If the AI
          // somehow leaked through the mux (e.g. silhouette derivation
          // failed and `applied=false`), this catches it.
          let handArtifactDamaged = false;
          let visibleMaskArtifacts = false;
          let handArtifactDrift = 0;
          let visibleArtifactRatio = 0;
          if (
            (category === "watch" || category === "hand-jewelry") &&
            openaiMeta.compositeAtTargetSize
          ) {
            try {
              // Decode the current finalResultUrl back to a Buffer.
              const m = finalResultUrl.match(/^data:image\/png;base64,(.+)$/);
              const finalBuf = m
                ? Buffer.from(m[1], "base64")
                : openaiMeta.resultBuffer;
              const handCheck = await checkHandArtifactDamage({
                userBase: openaiMeta.baseAtTargetSize,
                finalImage: finalBuf,
                allowedEditAlpha: openaiMeta.alphaMaskAtTargetSize ?? null,
              });
              const maskCheck = await checkVisibleMaskArtifacts({
                userBase: openaiMeta.baseAtTargetSize,
                finalImage: finalBuf,
              });
              handArtifactDamaged = handCheck.isDamaged;
              visibleMaskArtifacts = maskCheck.visible;
              handArtifactDrift = handCheck.drift;
              visibleArtifactRatio = maskCheck.outlinePixelRatio;

              if (handArtifactDamaged || visibleMaskArtifacts) {
                console.warn(
                  `[try-on] post-compose artefact gate failed category=${category} handDrift=${handArtifactDrift.toFixed(
                    4
                  )} outlineRatio=${visibleArtifactRatio.toFixed(
                    4
                  )} → deterministic fallback`
                );
                if (handArtifactDamaged)
                  failureReasons.push("hand_artifacts_detected");
                if (visibleMaskArtifacts)
                  failureReasons.push("visible_mask_artifacts");
                if (
                  fallbackToDeterministic &&
                  openaiMeta.compositeAtTargetSize
                ) {
                  finalResultUrl = `data:image/png;base64,${openaiMeta.compositeAtTargetSize.toString(
                    "base64"
                  )}`;
                  qualityCheckFallbackApplied = true;
                  qualityCheckFailed = true;
                  lockWarnings.push({
                    code: handArtifactDamaged
                      ? "hand-artifacts-detected"
                      : "visible-mask-artifacts",
                    message:
                      "Final image contained hand or mask artefacts — deterministic composite used.",
                  });
                }
              }
            } catch (err) {
              console.warn(
                "[try-on] post-compose artefact check threw",
                err instanceof Error ? err.message : err
              );
            }
          }
          // Expose new gate signals for QA dashboards.
          gates.handArtifactsClean = !handArtifactDamaged;
          gates.maskArtifactsInvisible = !visibleMaskArtifacts;

          if (!fidelity.passed || dup.duplicateDetected || ghost.ghostDetected) {
            qualityCheckFailed = true;
            if (!fidelity.colorOk) {
              failureReasons.push(
                `product-color-drift (Δ=${Math.round(fidelity.colorDelta)})`
              );
            }
            if (!fidelity.silhouetteRatioOk) {
              failureReasons.push("product-size-drift");
            }
            if (dup.duplicateDetected) {
              failureReasons.push(
                `product-duplication-detected (${dup.componentCount} product regions found)`
              );
            }
            if (ghost.ghostDetected) {
              failureReasons.push(
                `ghost-product-detected (ratio=${ghost.ghostRatio.toFixed(3)})`
              );
            }
            console.warn(
              `[try-on] product-fidelity-failed category=${category} reasons=${failureReasons.join(
                "|"
              )}`
            );

            if (!antiGhostApplied) {
              lockWarnings.push({
                code: dup.duplicateDetected
                  ? "product-duplication-detected"
                  : ghost.ghostDetected
                    ? "ghost-product-detected"
                    : "product-fidelity-check-failed",
                message: dup.duplicateDetected
                  ? `${dup.reason} Falling back to deterministic composite.`
                  : ghost.ghostDetected
                    ? `${ghost.reason} Falling back to deterministic composite.`
                    : `Product fidelity check failed: ${failureReasons.join(
                        ", "
                      )}.`,
              });
              // ── Tier 2: full deterministic fallback ─────────────
              // Hands the customer the deterministic composite —
              // product is pixel-perfect, contact shadows are less
              // refined. For watch / hand-jewelry we bypass the
              // `lockedProductLocked` guard because product-lock
              // only protects the product silhouette, not the
              // customer's fingers / nails / background. Anything
              // that hits this branch already failed a fidelity /
              // duplication / ghost gate, so the AI is suspect on
              // the surrounding pixels too.
              const ignoreLockGuard =
                category === "watch" || category === "hand-jewelry";
              if (
                fallbackToDeterministic &&
                (ignoreLockGuard || !lockedProductLocked) &&
                openaiMeta.compositeAtTargetSize
              ) {
                finalResultUrl = `data:image/png;base64,${openaiMeta.compositeAtTargetSize.toString(
                  "base64"
                )}`;
                qualityCheckFallbackApplied = true;
              }
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

      // ── Customer preservation gate ────────────────────────────────
      gates.customerPreservationValid =
        openaiMeta?.qualityChecks.outsideMaskPreserved ?? true;
      // Mask-artifact heuristic: when the OpenAI output shows an
      // outside-mask change score above 8% but below the strict 12%
      // ceiling, we flag potential mask outlines bleeding into the
      // skin. Above 12% the strict-preservation 502 handles it.
      const outsideScore = openaiMeta?.qualityChecks.outsideMaskChangeScore;
      gates.maskArtifactFree = !(
        typeof outsideScore === "number" && outsideScore > 0.08
      );

      // ── Strict customer preservation decision ─────────────────────
      // Ordered BEFORE the `debug` / `renderMode` construction so the
      // response we ship reflects every quality decision. Previously
      // this gate sat after `renderMode` was built, which meant the
      // debug payload disagreed with the fallback choice.
      //
      //  Two outcomes:
      //    - `debugStrictErrors=true` (QA / staging) → 502 with the
      //      technical reason.
      //    - production → silently switch to the deterministic
      //      composite, mark `qualityCheckFallbackApplied`. The
      //      customer ALWAYS receives a usable image.
      const outsideOk = openaiMeta?.qualityChecks.outsideMaskPreserved ?? true;
      const customerStrictMode =
        (process.env.OPENAI_PRESERVE_CUSTOMER_STRICT ?? "true")
          .trim()
          .toLowerCase() !== "false";
      let customerPreservationFallbackApplied = false;
      if (
        usedOpenAI &&
        customerStrictMode &&
        !outsideOk &&
        Boolean(openaiMeta?.maskUsed)
      ) {
        console.warn(
          `[try-on] customer-preservation-failed category=${category} score=${openaiMeta?.qualityChecks.outsideMaskChangeScore.toFixed(
            3
          )} debugStrictErrors=${debugStrictErrors}`
        );

        if (debugStrictErrors) {
          return NextResponse.json(
            {
              ok: false,
              provider: "openai",
              renderMode: "api-image-edit" as RenderMode,
              category,
              error:
                "[debug] customer-preservation gate failed: outside-mask drift above threshold.",
              qualityChecks: {
                ...openaiMeta?.qualityChecks,
                productLocked: lockedProductLocked,
                productFidelityMode,
                productSilhouetteRatio,
              },
              debug: {
                failureReasons: [
                  ...failureReasons,
                  "customer-preservation-failed",
                ],
                outsideMaskChangeScore:
                  openaiMeta?.qualityChecks.outsideMaskChangeScore,
              },
            },
            { status: 502 }
          );
        }

        // ── Customer-preservation retry ─────────────────────────────
        // Re-run OpenAI ONCE with a tighter, safer mask. Only attempt
        // when we have both the user photo and the composite (so we
        // can rebuild the silhouette server-side).
        if (
          !customerPreservationRetried &&
          inpaintComposite !== null &&
          isAccessory
        ) {
          customerPreservationRetried = true;
          try {
            const compositeBuf = Buffer.from(
              await inpaintComposite.arrayBuffer()
            );
            const userBuf = Buffer.from(await userImage.arrayBuffer());
            const meta = await sharp(compositeBuf).metadata();
            const tw = meta.width ?? 1024;
            const th = meta.height ?? 1024;
            const safer = await createRetryMaskForCustomerPreservation({
              userImage: userBuf,
              compositeImage: compositeBuf,
              targetWidth: tw,
              targetHeight: th,
              category,
            });
            if (safer && safer.buffer.length > 0) {
              const newMaskFile = new File(
                [new Uint8Array(safer.buffer)],
                "auto-mask-cp-retry.png",
                { type: "image/png" }
              );
              params.inpaintMask = newMaskFile;
              inpaintMask = newMaskFile;
              lastCustomerPreservationRetryDebug = {
                coverage: safer.coverage,
                outerDilatePx: safer.debug?.outerDilatePx,
                featherPx: safer.debug?.featherPx,
              };
              console.info(
                `[try-on] customer-preservation retry: tighter mask coverage=${safer.coverage.toFixed(
                  4
                )}`
              );
              continue retryLoop;
            }
          } catch (retryErr) {
            console.warn(
              "[try-on] customer-preservation retry failed",
              retryErr instanceof Error ? retryErr.message : retryErr
            );
          }
        }

        // Production fallback: swap to the deterministic composite
        // (preferred — already at the OpenAI target size) or the
        // user's original photo.
        if (
          fallbackToDeterministic &&
          openaiMeta?.compositeAtTargetSize
        ) {
          finalResultUrl = `data:image/png;base64,${openaiMeta.compositeAtTargetSize.toString(
            "base64"
          )}`;
          customerPreservationFallbackApplied = true;
          qualityCheckFallbackApplied = true;
          qualityCheckFailed = true;
          failureReasons.push("customer-preservation-failed");
          lockWarnings.push({
            code: "customer_preservation_fallback_used",
            message:
              "AI result changed too much outside the allowed edit area.",
          });
        }
      }

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
        // Reflects whichever local renderer kicked in — product
        // fidelity fallback OR customer-preservation fallback.
        usedLocalRenderer: qualityCheckFallbackApplied,
        maskUsed: usedOpenAI ? Boolean(openaiMeta?.maskUsed) : useInpainting,
        productLocked: lockedProductLocked,
        autoMaskGenerated,
        compositeUsed: Boolean(openaiMeta?.compositeUsedAsBase),
        productLockCandidate,
        productLockApplied: lockedProductLocked,
        fallbackUsed: qualityCheckFallbackApplied,
        customerPreservationFallbackApplied,
        antiGhostApplied,
        blackBarsRemoved: Boolean(openaiMeta?.blackBarsRemoved),
        inputDimensions,
        compositeDimensions: inputDimensions,
        maskDimensions: openaiMeta?.maskUsed ? inputDimensions : undefined,
        maskCoverage: openaiMeta?.maskCoverage,
        productAlphaDetected: Boolean(openaiMeta?.productHasAlpha),
        qualityCheckFailed,
        gates,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        ...(maskSafetyStats
          ? { maskSafetyStats, maskSafetyReasons }
          : {}),
        ...(customerPreservationRetried
          ? {
              customerPreservationRetried,
              customerPreservationRetryDebug:
                lastCustomerPreservationRetryDebug,
            }
          : {}),
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

      // Quality status reflects the most informative fallback signal:
      //  customer-preservation > product-fidelity > anti-ghost > passed.
      const finalQualityStatus = customerPreservationFallbackApplied
        ? ("fallback_customer_preservation" as const)
        : qualityCheckFallbackApplied
          ? failureReasons.some((r) => r.startsWith("product-"))
            ? ("fallback_product_fidelity" as const)
            : ("fallback-preview" as const)
          : ("passed" as const);

      return NextResponse.json({
        ok: true,
        resultUrl: finalResultUrl,
        previewUrl: result.previewUrl,
        generatedAt: result.generatedAt,
        mock: result.mock,
        // Provider stays "openai" so analytics still credit the AI run —
        // the renderMode + qualityStatus + debug.fallbackUsed expose
        // the local-renderer override for QA.
        provider: result.provider,
        model: result.model,
        category: result.category ?? category,
        durationMs,
        debug,
        renderMode,
        qualityStatus: finalQualityStatus,
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

      // ── Mask-too-small one-shot retry ──────────────────────────────
      // Regenerate via `autoMaskFromComposite` (which widens
      // progressively) and re-enter the loop. We only attempt this
      // once and only if we have a composite available — otherwise
      // there's nothing to diff against.
      if (
        premiumError instanceof MaskValidationError &&
        premiumError.code === "mask-too-small" &&
        !maskTooSmallRetried &&
        inpaintComposite !== null
      ) {
        maskTooSmallRetried = true;
        try {
          const compositeBuf = Buffer.from(
            await inpaintComposite.arrayBuffer()
          );
          const userBuf = Buffer.from(await userImage.arrayBuffer());
          const meta = await sharp(compositeBuf).metadata();
          const tw = meta.width ?? 1024;
          const th = meta.height ?? 1024;
          const auto = await autoMaskFromComposite({
            userImage: userBuf,
            compositeImage: compositeBuf,
            targetWidth: tw,
            targetHeight: th,
            category,
          });
          if (auto && auto.buffer.length > 0) {
            const newMaskFile = new File(
              [new Uint8Array(auto.buffer)],
              "auto-mask-retry.png",
              { type: "image/png" }
            );
            params.inpaintMask = newMaskFile;
            inpaintMask = newMaskFile;
            lastMaskTooSmallRetryDebug = {
              coverage: auto.coverage,
              outerDilatePx: auto.debug?.outerDilatePx,
              featherPx: auto.debug?.featherPx,
            };
            console.info(
              `[try-on] mask-too-small retry: regenerated auto-mask coverage=${auto.coverage.toFixed(4)}`
            );
            continue retryLoop;
          }
        } catch (retryErr) {
          console.warn(
            "[try-on] mask-too-small server retry failed",
            retryErr instanceof Error ? retryErr.message : retryErr
          );
        }
        // Retry path exhausted — fall through to graceful deterministic
        // fallback below (we deliberately do NOT return a 400).
      }

      // Other MaskValidationError variants — historically these
      // returned a 400 with the raw "Mask covers …" message. In
      // production the customer never sees them: we fall back to the
      // deterministic composite when one exists. Only `debugStrictErrors`
      // brings the 400 back, for QA / staging.
      const isMaskOtherError =
        premiumError instanceof MaskRequiredError ||
        premiumError instanceof MaskDimensionError ||
        (premiumError instanceof MaskValidationError &&
          premiumError.code !== "mask-too-small");

      if (isMaskOtherError) {
        const durationMs = Date.now() - startedAt;
        if (!debugStrictErrors && fallbackToDeterministic && finalPreview) {
          // Map the error to a fallback `qualityStatus` so analytics
          // can still distinguish dimension errors from coverage
          // errors. Customers see the same soft note either way.
          let fallbackStatus: QualityStatus = "fallback_mask_validation";
          if (premiumError instanceof MaskDimensionError) {
            fallbackStatus = "fallback_mask_dimensions";
          } else if (premiumError instanceof MaskValidationError) {
            if (premiumError.code === "mask-too-large") {
              fallbackStatus = "fallback_mask_too_large";
            } else if (premiumError.code === "mask-dimension") {
              fallbackStatus = "fallback_mask_dimensions";
            }
          }
          const resultUrl = await uploadPreviewToCdn(
            finalPreview,
            hasFalKey
          );
          const softWarnings = [
            ...clientWarnings,
            {
              code: "mask_validation_fallback_used",
              message:
                "AI result rejected by mask validation. Deterministic composite used as a safe fallback.",
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
            errorCode: premiumError.name,
          });
          console.warn(
            `[try-on] ${fallbackStatus} category=${category} reason=${premiumError.message}`
          );
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
            qualityStatus: fallbackStatus,
            warnings: softWarnings,
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
              fallbackUsed: true,
              fallbackReason: premiumError.name,
              qualityCheckFailed: true,
              failureReasons: ["mask-validation-failed"],
            },
          });
        }

        // Strict / debug mode — surface the technical 400.
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

      // ── Mask-too-small soft fallback ─────────────────────────────
      // We tried the server retry above (or had no composite to retry
      // with). Returning a 4xx/5xx with a raw mask-coverage message
      // would leak internal vocabulary to the customer. Instead, we
      // ALWAYS try to serve the deterministic composite — even when
      // `apiOnlyMode` is set — and downgrade the response cleanly.
      if (
        premiumError instanceof MaskValidationError &&
        premiumError.code === "mask-too-small"
      ) {
        if (finalPreview) {
          const resultUrl = await uploadPreviewToCdn(finalPreview, hasFalKey);
          const softWarnings = [
            ...clientWarnings,
            {
              code: "auto_mask_too_small_fallback_used",
              message:
                "Nous avons utilisé le rendu le plus fiable pour préserver votre photo.",
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
            errorCode: "MaskTooSmallFallback",
          });
          console.warn(
            `[try-on] mask-too-small fallback category=${category} attempts=${
              maskTooSmallRetried ? 1 : 0
            } → deterministic composite`
          );
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
            qualityStatus: "fallback_mask_too_small",
            warnings: softWarnings,
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
              maskDebug: lastMaskTooSmallRetryDebug ?? undefined,
              fallbackReason: "auto_mask_too_small",
              maskRetryAttempted: maskTooSmallRetried,
            },
          });
        }
        // No deterministic preview to fall back to → soft 200 with a
        // friendly note (still no raw technical message).
        return NextResponse.json(
          {
            ok: false,
            provider: openaiActive ? "openai" : envProvider,
            renderMode: "api-image-edit" as RenderMode,
            category,
            error:
              "Nous n'avons pas pu finaliser cet essayage. Essayez avec une autre photo (poignet plus dégagé, fond plus net).",
          },
          { status: 200 }
        );
      }

      // ── API-only mode → strict error (debug only) ─────────────────
      // The legacy semantics were "apiOnlyMode ⇒ never fall back". In
      // production that path leaked raw OpenAI errors to the customer
      // and broke the "no technical error" rule. The hard 502 now only
      // fires under `TRYON_DEBUG_STRICT_ERRORS=true` so QA can still
      // catch regressions; production falls through to the graceful
      // deterministic fallback below.
      if (apiOnlyMode && debugStrictErrors) {
        console.error(
          `[try-on] api-only-failed-strict category=${category} durationMs=${durationMs} message=${safeMessage}`
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
              "[debug] OpenAI image edit failed. No local renderer fallback was used because TRYON_DEBUG_STRICT_ERRORS is enabled.",
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
    } // end retryLoop (mask-too-small one-shot retry)
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
