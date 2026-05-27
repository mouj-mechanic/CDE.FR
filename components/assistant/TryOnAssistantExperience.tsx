"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  Camera,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  Category,
  CategoryId,
  FingerId,
  HandJewelryType,
  ProductItem,
  TryOnHistoryEntry,
  TryOnResponse,
} from "@/types";
import { CATEGORIES, getCategory, isValidCategoryId } from "@/lib/categories";
import { initialTryOnState, tryOnReducer } from "@/lib/tryOnReducer";
import { runTryOnPipeline } from "@/lib/tryon/pipeline";
import {
  compressImageBlob,
  compressImageFile,
} from "@/lib/clientImageCompression";
import { safeFetchJson } from "@/lib/safeFetchJson";
import { ImageUploader } from "../ImageUploader";
import { HandJewelryOptions } from "../HandJewelryOptions";
import { LaunchButton } from "../LaunchButton";
import { useTryOnAssistant } from "./useTryOnAssistant";
import { TryOnAssistantBubble } from "./TryOnAssistantBubble";
import { AssistantLightbox } from "./AssistantLightbox";
import { generateProductOpinion } from "@/lib/productOpinion";
import {
  postAddToCart,
  type ProductContextPayload,
} from "@/lib/embedMessaging";
import { nextPaint } from "@/lib/nextPaint";
import { generateId } from "@/lib/utils";
import { detectCategoryFromTitle } from "@/lib/detectCategory";
import { cn } from "@/lib/utils";

export interface TryOnAssistantExperienceProps {
  /**
   * Initial category. When the embed iframe ships with a product
   * detected on the merchant page, this is auto-detected; when the
   * user lands without a product they pick one from the inline
   * category picker.
   */
  initialCategoryId: CategoryId;
  /** Optional initial product (Shopify auto-flow). */
  product?: ProductItem;
  productTitle?: string | null;
  productImage?: string | null;
  merchantId?: string | null;
  /**
   * Optional callback fired when the user explicitly closes the
   * bubble. The embed layer uses this to dispatch
   * `TRYWITHAI_CLOSE` to the parent storefront.
   */
  onClose?: () => void;
  /**
   * Optional callback when the user taps the "Agrandir" / image
   * preview. Lets the host page open its own lightbox. Defaults to
   * a no-op (the bubble itself already shows the result image).
   */
  onOpenLightbox?: (resultUrl: string) => void;
}

/**
 * Full conversational try-on flow rendered ENTIRELY inside the
 * floating bubble. There is no big modal anymore — the bubble hosts
 * photo upload, instructions, consent, launch button, progress,
 * result image, opinion, and the cart/share/try-another actions.
 */
export function TryOnAssistantExperience({
  initialCategoryId,
  product,
  productTitle,
  productImage,
  merchantId,
  onClose,
  onOpenLightbox,
}: TryOnAssistantExperienceProps) {
  const [categoryId, setCategoryId] = useState<CategoryId>(initialCategoryId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [handJewelryType, setHandJewelryType] =
    useState<HandJewelryType>("ring");
  const [ringFinger, setRingFinger] = useState<FingerId>("ring");
  const category = getCategory(categoryId) as Category;

  const [state, dispatch] = useReducer(tryOnReducer, {
    ...initialTryOnState,
    products: product ? [product] : [],
  });

  const assistant = useTryOnAssistant();

  // Boot the bubble on mount so the compose view is visible from
  // frame 1. This is the whole point of the refactor: no big modal,
  // the bubble IS the experience.
  useEffect(() => {
    assistant.boot({
      category: categoryId,
      productTitle: productTitle ?? product?.title ?? undefined,
      productUrl:
        product?.type === "url" ? product.value : undefined,
      productImage:
        productImage ?? product?.previewUrl ?? undefined,
    });
    // We deliberately depend only on the boot identity; subsequent
    // category changes do NOT re-boot (it would wipe the conversation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for parent cart confirmations / errors. The host echoes
  // back the entryId we sent with the add-to-cart so we can update
  // the right card; we fall back to the most recent entry if the
  // host omits it (legacy embed scripts). The host emits messages
  // shaped as `{ type, payload, source: "trywithai-host" }`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      const msg = e.data as {
        type?: string;
        source?: string;
        entryId?: string;
        payload?: ProductContextPayload & { entryId?: string };
      };
      // Merchant PDP changed — update compose context without
      // reloading the iframe (running try-ons keep progressing).
      if (
        msg.source === "trywithai-host" &&
        msg.type === "TRYWITHAI_PRODUCT_CONTEXT" &&
        msg.payload
      ) {
        const p = msg.payload;
        const nextCategory =
          p.category && isValidCategoryId(p.category)
            ? p.category
            : detectCategoryFromTitle(p.productTitle ?? productTitle);
        if (p.productImage || p.productUrl) {
          dispatch({ type: "CLEAR_PRODUCTS" });
          dispatch({
            type: "ADD_PRODUCT",
            product: {
              id: generateId(),
              type: "url",
              value: p.productImage ?? p.productUrl ?? "",
              previewUrl: p.productImage ?? undefined,
              source: "shopify",
              title: p.productTitle ?? productTitle ?? undefined,
            },
          });
        }
        assistant.boot({
          category: nextCategory,
          productTitle: p.productTitle ?? productTitle ?? undefined,
          productUrl: p.productUrl ?? undefined,
          productImage: p.productImage ?? undefined,
        });
        return;
      }

      const entryIdFromPayload =
        msg.payload && typeof msg.payload === "object"
          ? msg.payload.entryId
          : undefined;
      const fallbackId =
        assistant.state.history[assistant.state.history.length - 1]?.id;
      const targetId = msg.entryId ?? entryIdFromPayload ?? fallbackId;
      if (msg.type === "TRYWITHAI_CART_ADDED") {
        if (targetId) {
          assistant.cartStatusForEntry(targetId, "added");
        } else {
          assistant.cartStatus("added");
        }
      } else if (msg.type === "TRYWITHAI_CART_ERROR") {
        if (targetId) {
          assistant.cartStatusForEntry(targetId, "error");
        } else {
          assistant.cartStatus("error");
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [assistant]);

  // ── Main submit handler ───────────────────────────────────────────
  const submit = useCallback(async () => {
    if (!state.userImage) {
      assistant.pushMessage(
        "Importez d’abord une photo pour lancer l’essayage.",
        "warning"
      );
      return;
    }
    if (state.products.length === 0) {
      assistant.pushMessage(
        "Aucun article détecté — ajoutez une image ou un lien produit.",
        "warning"
      );
      return;
    }
    if (!consent) {
      assistant.pushMessage(
        "Cochez l’accord d’utilisation de votre photo pour continuer.",
        "warning"
      );
      return;
    }

    dispatch({ type: "SET_STATUS", status: "loading" });
    dispatch({ type: "SET_ERROR", error: null });

    // Snapshot inputs so a PDP change mid-flight cannot empty
    // products[] while this job is still uploading.
    const snapUserImage = state.userImage;
    const snapProducts = state.products.slice();
    const firstProduct = snapProducts[0];
    // Capture the jobId returned by start() — we'll pass it to
    // ready()/error() so that, even if the customer kicks off
    // another try-on before this one resolves, the right history
    // card is finalised.
    const currentJobId = assistant.start({
      category: categoryId,
      productTitle: firstProduct?.title ?? productTitle ?? undefined,
      productUrl:
        firstProduct?.type === "url" ? firstProduct.value : undefined,
      productImage:
        firstProduct?.previewUrl ??
        (firstProduct?.type === "url" ? firstProduct.value : undefined),
    });

    await nextPaint();

    const firstProductFile =
      snapProducts.find((p) => p.type === "image" && p.file)?.file ?? null;
    const firstProductUrl =
      snapProducts.find((p) => p.type === "url")?.value ?? null;
    const firstProductCutout = firstProduct?.cutoutUrl ?? null;

    let pipelineResult: Awaited<ReturnType<typeof runTryOnPipeline>> | null =
      null;
    try {
      pipelineResult = await runTryOnPipeline({
        category: categoryId,
        userFile: snapUserImage,
        productFile: firstProductFile,
        productUrl: firstProductUrl,
        productCutoutUrl: firstProductCutout,
        mode: "auto",
        handJewelryType,
        ringFinger,
      });
    } catch (err) {
      console.warn("[tryon] pipeline failed", err);
    }

    let uploadUser: File = snapUserImage;
    try {
      uploadUser = await compressImageFile(snapUserImage, {
        maxDim: 1600,
        quality: 0.88,
        mimeType: "image/jpeg",
        skipIfSmallerThan: 1.4 * 1024 * 1024,
      });
    } catch (err) {
      console.warn("[tryon] user image compression failed", err);
    }

    let compositeBlob: Blob | null = pipelineResult?.previewBlob ?? null;
    let maskBlob: Blob | null = pipelineResult?.maskBlob ?? null;
    if (compositeBlob) {
      try {
        compositeBlob = await compressImageBlob(compositeBlob, {
          maxDim: 1280,
          quality: 0.92,
          mimeType: "image/png",
        });
      } catch (err) {
        console.warn("[tryon] composite resize failed", err);
      }
    }
    if (maskBlob) {
      try {
        maskBlob = await compressImageBlob(maskBlob, {
          maxDim: 1280,
          quality: 0.92,
          mimeType: "image/png",
        });
      } catch (err) {
        console.warn("[tryon] mask resize failed", err);
      }
    }

    const formData = new FormData();
    formData.append("category", categoryId);
    formData.append("userImage", uploadUser);
    formData.append("renderModeRequest", "auto");
    formData.append("handJewelryType", handJewelryType);
    formData.append("ringFinger", ringFinger);

    if (compositeBlob) {
      formData.append(
        "compositeImage",
        new File([compositeBlob], "trywithai-composite.png", {
          type: "image/png",
        })
      );
      formData.append(
        "warnings",
        JSON.stringify(pipelineResult?.warnings ?? [])
      );
    }
    if (maskBlob) {
      formData.append(
        "maskImage",
        new File([maskBlob], "trywithai-mask.png", { type: "image/png" })
      );
    }
    if (pipelineResult) {
      formData.append(
        "productHasAlpha",
        pipelineResult.productHasAlpha ? "true" : "false"
      );
      formData.append("productMimeType", pipelineResult.productMimeType);
      formData.append("productImageSource", pipelineResult.productImageSource);
      if (pipelineResult.watchPlacement) {
        formData.append(
          "watchPlacement",
          JSON.stringify(pipelineResult.watchPlacement)
        );
      }
      if (typeof pipelineResult.edgeQuality === "number") {
        formData.append("edgeQuality", String(pipelineResult.edgeQuality));
      }
    }

    const urls = snapProducts
      .filter((p) => p.type === "url")
      .map((p) => p.value);
    formData.append("productUrls", JSON.stringify(urls));

    const cutoutUrls = snapProducts
      .map((p) => p.cutoutUrl)
      .filter((u): u is string => Boolean(u));
    if (cutoutUrls.length > 0) {
      formData.append("productCutoutUrls", JSON.stringify(cutoutUrls));
    }

    const productFiles = snapProducts
      .filter((p) => p.type === "image" && p.file)
      .map((p) => p.file as File);
    for (const file of productFiles) {
      let upload = file;
      try {
        upload = await compressImageFile(file, {
          maxDim: 1400,
          quality: 0.9,
          mimeType: file.type === "image/png" ? "image/png" : "image/jpeg",
          skipIfSmallerThan: 1.2 * 1024 * 1024,
        });
      } catch (err) {
        console.warn("[tryon] product image compression failed", err);
      }
      formData.append("productImages", upload);
    }

    if (productTitle) formData.append("notes", `Article : ${productTitle}`);
    if (merchantId) formData.append("merchantId", merchantId);

    try {
      const result = await safeFetchJson<
        TryOnResponse & {
          error?: string;
          details?: string;
          provider?: string;
        }
      >("/api/try-on", { method: "POST", body: formData });

      if (result.nonJson || !result.data) {
        throw new Error(
          result.errorMessage ?? "Réponse inattendue du serveur."
        );
      }

      const data = result.data;
      const hasShowableResult = Boolean(data.resultUrl);
      if (!result.ok && !hasShowableResult) {
        throw new Error(
          "Le rendu IA n’a pas pu être généré. Veuillez réessayer ou importer une autre photo."
        );
      }

      dispatch({
        type: "SET_RESULT",
        resultUrl: data.resultUrl,
        meta: {
          provider: data.provider,
          model: data.model,
          mock: data.mock,
          renderMode: data.renderMode,
          qualityStatus: data.qualityStatus,
          warnings: data.warnings,
          maskUsed: data.debug?.maskUsed,
          usedLocalRenderer: data.debug?.usedLocalRenderer,
          qualityChecks: data.qualityChecks,
          productLocked: data.productLocked ?? data.debug?.productLocked,
          fallbackUsed: data.debug?.fallbackUsed,
          autoMaskGenerated: data.debug?.autoMaskGenerated,
        },
      });

      const opinion = generateProductOpinion({
        category: categoryId,
        productTitle: snapProducts[0]?.title ?? productTitle ?? undefined,
        warnings: data.warnings,
        qualityStatus: data.qualityStatus,
        fallbackUsed: data.debug?.fallbackUsed,
      });
      assistant.ready({
        jobId: currentJobId,
        resultUrl: data.resultUrl,
        opinion,
        fallbackUsed: data.debug?.fallbackUsed,
        qualityStatus: data.qualityStatus,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Une erreur est survenue. Veuillez réessayer.";
      dispatch({ type: "SET_ERROR", error: msg });
      dispatch({ type: "SET_STATUS", status: "error" });
      assistant.error(msg, currentJobId);
    }
  }, [
    state,
    categoryId,
    consent,
    productTitle,
    merchantId,
    handJewelryType,
    ringFinger,
    assistant,
  ]);

  // ── Per-card action handlers ──────────────────────────────────────
  // Each history card carries its own buttons; clicks dispatch using
  // the card's entry.id so only that card's state updates.
  const [lightboxEntry, setLightboxEntry] = useState<TryOnHistoryEntry | null>(
    null
  );

  const handleCardAddToCart = useCallback(
    (entry: TryOnHistoryEntry) => {
      assistant.cartStatusForEntry(entry.id, "adding");
      postAddToCart({
        jobId: entry.jobId,
        resultUrl: entry.resultUrl,
        productTitle: entry.productTitle,
        // Pass the entry id through so the host can echo it back
        // and we update the right card on reply.
        entryId: entry.id,
      });
      window.setTimeout(() => {
        const stillAdding = assistant.state.history.find(
          (e) => e.id === entry.id
        )?.cartStatus;
        if (stillAdding === "adding") {
          assistant.cartStatusForEntry(entry.id, "error");
        }
      }, 8000);
    },
    [assistant]
  );

  const handleCardAgrandir = useCallback((entry: TryOnHistoryEntry) => {
    if (!entry.resultUrl) return;
    // In-iframe lightbox only — never window.open (popup blockers +
    // blob: URLs show about:blank#blocked in a new tab).
    setLightboxEntry(entry);
  }, []);

  const handleTryAnother = useCallback(() => {
    dispatch({ type: "RESET_PRODUCT_KEEP_PHOTO" });
    setConsent(true);
    assistant.newTry();
  }, [assistant]);

  /**
   * Retry handler for error / interrupted cards. We simply call
   * submit() again — the customer's photo is already in `state` so
   * the launch goes through immediately.
   */
  const handleCardRetry = useCallback(
    (_entry: TryOnHistoryEntry) => {
      void submit();
    },
    // submit is defined below as a useCallback — keep deps loose to
    // avoid a hook-ordering issue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Compose view (rendered inside the bubble while status=idle) ──
  const composeNode = useMemo(
    () => (
      <div className="space-y-3">
        {productImage && (
          <div className="flex items-center gap-3 rounded-2xl border border-gold/40 bg-gradient-to-r from-gold/10 to-transparent p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={productImage}
              alt={productTitle ?? "Article"}
              className="h-12 w-12 shrink-0 rounded-lg bg-cream-dark object-cover ring-1 ring-ink/10"
            />
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1 rounded-md bg-bordeaux/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-bordeaux">
                Article boutique
              </span>
              <p className="mt-0.5 truncate text-xs font-medium text-ink">
                {productTitle ?? "Article détecté"}
              </p>
            </div>
          </div>
        )}

        {/* Category picker — compact, inline. */}
        <div className="flex items-center gap-2 rounded-xl bg-cream-light px-3 py-2 ring-1 ring-bordeaux/10">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-bordeaux" aria-hidden />
          <span className="truncate text-xs font-medium text-ink">
            {category.label}
          </span>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-bordeaux ring-1 ring-bordeaux/15"
            aria-expanded={pickerOpen}
          >
            <Settings2 className="h-3 w-3" aria-hidden />
            Changer
          </button>
        </div>
        {pickerOpen && (
          <div className="grid grid-cols-3 gap-1.5">
            {CATEGORIES.map((c) => {
              const isActive = c.id === categoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(c.id);
                    setPickerOpen(false);
                  }}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-[10px] font-medium leading-tight",
                    isActive
                      ? "border-bordeaux bg-bordeaux/5 text-bordeaux"
                      : "border-ink/10 bg-white text-ink hover:border-bordeaux/30"
                  )}
                >
                  {c.label.split(" / ")[0]}
                </button>
              );
            })}
          </div>
        )}

        {/* Single-line instruction */}
        <div className="flex items-start gap-2 rounded-xl bg-bordeaux/5 px-3 py-2 text-[11px] leading-snug text-ink">
          <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bordeaux" aria-hidden />
          <p>{category.photoSingleInstruction}</p>
        </div>

        {/* Photo uploader */}
        <ImageUploader
          previewUrl={state.userImagePreview}
          onImageSelect={(file, previewUrl) =>
            dispatch({ type: "SET_USER_IMAGE", file, previewUrl })
          }
          onImageClear={() => dispatch({ type: "CLEAR_USER_IMAGE" })}
          error={state.error}
          preferredFacingMode={
            categoryId === "glasses" ? "user" : "environment"
          }
        />

        {categoryId === "hand-jewelry" && (
          <HandJewelryOptions
            type={handJewelryType}
            onTypeChange={setHandJewelryType}
            finger={ringFinger}
            onFingerChange={setRingFinger}
          />
        )}

        {/* Compact consent */}
        <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-cream-light px-3 py-2 text-[11px] leading-snug text-ink-muted ring-1 ring-bordeaux/10">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-bordeaux/30 text-bordeaux focus:ring-bordeaux"
          />
          <span>
            <ShieldCheck className="mr-1 inline-block h-3 w-3 text-bordeaux" aria-hidden />
            J’accepte que ma photo soit utilisée le temps de générer l’aperçu IA.
            <span className="block text-[10px] text-ink-muted/70">
              Aucune sauvegarde permanente.
            </span>
          </span>
        </label>

        <LaunchButton onClick={submit} disabled={!consent || !state.userImage} />

        {state.error && (
          <p className="text-[11px] text-bordeaux" role="alert">
            {state.error}
          </p>
        )}
      </div>
    ),
    [
      productImage,
      productTitle,
      category.label,
      category.photoSingleInstruction,
      pickerOpen,
      categoryId,
      state.userImagePreview,
      state.error,
      state.userImage,
      handJewelryType,
      ringFinger,
      consent,
      submit,
    ]
  );

  const handleClose = useCallback(() => {
    // Explicit close = end of conversation. Wipe the bubble state
    // and the persisted sessionStorage payload so the next visit
    // starts fresh.
    assistant.clearSession();
    setLightboxEntry(null);
    if (onClose) onClose();
  }, [assistant, onClose]);

  return (
    <>
      <TryOnAssistantBubble
        state={assistant.state}
        composeNode={composeNode}
        onMinimize={assistant.minimize}
        onRestore={assistant.restore}
        onTryAnother={handleTryAnother}
        onCardAddToCart={handleCardAddToCart}
        onCardAgrandir={handleCardAgrandir}
        onCardRetry={handleCardRetry}
        onClose={handleClose}
      />
      <AssistantLightbox
        imageUrl={lightboxEntry?.resultUrl ?? null}
        productTitle={lightboxEntry?.productTitle ?? undefined}
        onClose={() => setLightboxEntry(null)}
      />
    </>
  );
}
