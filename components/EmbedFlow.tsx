"use client";

import { useCallback, useReducer, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings2 } from "lucide-react";
import type {
  Category,
  CategoryId,
  FingerId,
  HandJewelryType,
  ProductItem,
  TryOnResponse,
} from "@/types";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { initialTryOnState, tryOnReducer } from "@/lib/tryOnReducer";
import { runTryOnPipeline } from "@/lib/tryon/pipeline";
import {
  compressImageBlob,
  compressImageFile,
} from "@/lib/clientImageCompression";
import { safeFetchJson } from "@/lib/safeFetchJson";
import { HandJewelryOptions } from "./HandJewelryOptions";
import { PhotoGuideSteps } from "./PhotoGuideSteps";
import { ImageUploader } from "./ImageUploader";
import { LaunchButton } from "./LaunchButton";
import { Stage } from "./Stage";
import { LoadingScene } from "./LoadingScene";
import { ResultView } from "./ResultView";
import { WatchAdjustPanel } from "./WatchAdjustPanel";
import { CategoryIcon } from "./CategoryIcon";
import { PrivacyNote } from "./PrivacyNote";
import { ConsentCheckbox } from "./ConsentCheckbox";
import { PhotoQualityChecklist } from "./PhotoQualityChecklist";
import { MaskTestUploader } from "./MaskTestUploader";
import { cn } from "@/lib/utils";

interface EmbedFlowProps {
  initialCategoryId: CategoryId;
  product: ProductItem;
  productTitle?: string | null;
  productImage?: string | null;
  merchantId?: string | null;
}

export function EmbedFlow({
  initialCategoryId,
  product,
  productTitle,
  productImage,
  merchantId,
}: EmbedFlowProps) {
  const [categoryId, setCategoryId] = useState<CategoryId>(initialCategoryId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [handJewelryType, setHandJewelryType] =
    useState<HandJewelryType>("ring");
  const [ringFinger, setRingFinger] = useState<FingerId>("ring");
  const [watchOverrideUrl, setWatchOverrideUrl] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [manualMask, setManualMask] = useState<File | null>(null);
  const category = getCategory(categoryId) as Category;

  const [state, dispatch] = useReducer(tryOnReducer, {
    ...initialTryOnState,
    products: [product],
  });

  const validateAndSubmit = useCallback(async () => {
    if (!state.userImage) {
      dispatch({
        type: "SET_ERROR",
        error: "Veuillez importer votre photo avant de lancer l'essayage.",
      });
      return;
    }
    if (!consent) {
      dispatch({
        type: "SET_ERROR",
        error: "Veuillez accepter l'utilisation de votre photo.",
      });
      return;
    }

    dispatch({ type: "SET_STATUS", status: "loading" });
    dispatch({ type: "SET_ERROR", error: null });

    const firstProduct = state.products[0];
    const firstProductFile =
      state.products.find((p) => p.type === "image" && p.file)?.file ?? null;
    const firstProductUrl =
      state.products.find((p) => p.type === "url")?.value ?? null;
    const firstProductCutout = firstProduct?.cutoutUrl ?? null;

    let pipelineResult: Awaited<ReturnType<typeof runTryOnPipeline>> | null =
      null;
    try {
      pipelineResult = await runTryOnPipeline({
        category: categoryId,
        userFile: state.userImage,
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

    // Compress images before upload so we never trip Vercel's 4.5 MB body
    // limit (which returns a non-JSON "Request Entity Too Large" error).
    let uploadUser: File = state.userImage;
    try {
      uploadUser = await compressImageFile(state.userImage, {
        maxDim: 1600,
        quality: 0.88,
        mimeType: "image/jpeg",
        skipIfSmallerThan: 1.4 * 1024 * 1024,
      });
    } catch (err) {
      console.warn("[tryon] user image compression failed", err);
    }

    let uploadPreview: Blob | null = pipelineResult?.previewBlob ?? null;
    if (uploadPreview) {
      try {
        uploadPreview = await compressImageBlob(uploadPreview, {
          maxDim: 1280,
          quality: 0.85,
          mimeType: "image/jpeg",
        });
      } catch (err) {
        console.warn("[tryon] preview compression failed", err);
      }
    }

    const formData = new FormData();
    formData.append("category", categoryId);
    formData.append("userImage", uploadUser);
    formData.append("renderModeRequest", "auto");
    formData.append("handJewelryType", handJewelryType);
    formData.append("ringFinger", ringFinger);

    if (uploadPreview) {
      formData.append(
        "previewImage",
        new File([uploadPreview], "trywithai-preview.jpg", {
          type: uploadPreview.type || "image/jpeg",
        })
      );
      formData.append(
        "warnings",
        JSON.stringify(pipelineResult?.warnings ?? [])
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

    const urls = state.products
      .filter((p) => p.type === "url")
      .map((p) => p.value);
    formData.append("productUrls", JSON.stringify(urls));

    const cutoutUrls = state.products
      .map((p) => p.cutoutUrl)
      .filter((u): u is string => Boolean(u));
    if (cutoutUrls.length > 0) {
      formData.append("productCutoutUrls", JSON.stringify(cutoutUrls));
    }

    const productFiles = state.products
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

    // Optional manual mask attached by the operator (debug / testing).
    if (manualMask) {
      formData.append("maskImage", manualMask);
    }

    try {
      const result = await safeFetchJson<
        TryOnResponse & {
          error?: string;
          details?: string;
          provider?: string;
        }
      >("/api/try-on", {
        method: "POST",
        body: formData,
      });

      if (result.nonJson || !result.data) {
        throw new Error(
          result.errorMessage ?? "Réponse inattendue du serveur."
        );
      }

      const data = result.data;
      if (!result.ok) {
        if (data.debug?.productImageCount === 0) {
          throw new Error(
            "Image produit manquante : ajoutez une image produit pour générer l'essayage."
          );
        }
        if (data.provider === "fal") {
          throw new Error(
            "Le mode IA réel est actif, mais la génération a échoué. Vérifiez la clé API, les crédits fal.ai ou les logs serveur."
          );
        }
        throw new Error(data.error ?? "Erreur lors de la génération.");
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
        },
      });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error:
          err instanceof Error
            ? err.message
            : "Une erreur est survenue. Veuillez réessayer.",
      });
      dispatch({ type: "SET_STATUS", status: "error" });
    }
  }, [
    state,
    categoryId,
    productTitle,
    consent,
    merchantId,
    handJewelryType,
    ringFinger,
    manualMask,
  ]);

  /**
   * FLUX Fill refinement on the current watch composite + contact-band
   * mask. See `TryOnPanel.refineWithAI` for the matching standalone flow.
   */
  const refineWithAI = useCallback(
    async (composite: Blob, mask: Blob) => {
      if (!state.userImage) return;
      setRefineError(null);
      setRefining(true);
      try {
        const fd = new FormData();
        fd.append("category", categoryId);
        fd.append("renderModeRequest", "premium");
        fd.append("useInpainting", "true");
        fd.append("handJewelryType", handJewelryType);
        fd.append("ringFinger", ringFinger);

        let uploadUser: File = state.userImage;
        try {
          uploadUser = await compressImageFile(state.userImage, {
            maxDim: 1600,
            quality: 0.88,
            mimeType: "image/jpeg",
            skipIfSmallerThan: 1.4 * 1024 * 1024,
          });
        } catch {
          // fall back to raw file
        }
        fd.append("userImage", uploadUser);

        fd.append(
          "compositeImage",
          new File([composite], "trywithai-composite.png", {
            type: "image/png",
          })
        );
        fd.append(
          "maskImage",
          new File([mask], "trywithai-mask.png", { type: "image/png" })
        );

        state.products
          .filter((p) => p.type === "image" && p.file)
          .forEach((p) => {
            if (p.file) fd.append("productImages", p.file);
          });
        const urls = state.products
          .filter((p) => p.type === "url")
          .map((p) => p.value);
        fd.append("productUrls", JSON.stringify(urls));

        if (merchantId) fd.append("merchantId", merchantId);
        if (productTitle) fd.append("notes", `Article : ${productTitle}`);

        const result = await safeFetchJson<
          TryOnResponse & {
            error?: string;
            details?: string;
            provider?: string;
          }
        >("/api/try-on", { method: "POST", body: fd });

        if (result.nonJson || !result.data) {
          throw new Error(
            result.errorMessage ?? "Réponse inattendue du serveur."
          );
        }
        if (!result.ok) {
          throw new Error(
            result.data.error ?? "La génération IA a échoué."
          );
        }

        dispatch({
          type: "SET_RESULT",
          resultUrl: result.data.resultUrl,
          meta: {
            provider: result.data.provider,
            model: result.data.model,
            mock: result.data.mock,
            renderMode: result.data.renderMode,
            qualityStatus: result.data.qualityStatus,
            warnings: result.data.warnings,
            maskUsed: result.data.debug?.maskUsed,
            usedLocalRenderer: result.data.debug?.usedLocalRenderer,
          },
        });
        setWatchOverrideUrl(null);
      } catch (err) {
        setRefineError(
          err instanceof Error ? err.message : "Erreur lors du raffinement IA."
        );
      } finally {
        setRefining(false);
      }
    },
    [
      state.userImage,
      state.products,
      categoryId,
      productTitle,
      merchantId,
      handJewelryType,
      ringFinger,
    ]
  );

  const isLoading = state.status === "loading";
  const showStage = isLoading || !!state.resultUrl;

  if (showStage) {
    return (
      <div className="space-y-4">
        <Stage>
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.4 }}
              >
                <LoadingScene category={category} />
              </motion.div>
            ) : state.resultUrl ? (
              <motion.div
                key="result"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              >
                <ResultView
                  resultUrl={watchOverrideUrl ?? state.resultUrl}
                  provider={state.resultMeta?.provider}
                  model={state.resultMeta?.model}
                  mock={state.resultMeta?.mock}
                  renderMode={state.resultMeta?.renderMode}
                  qualityStatus={state.resultMeta?.qualityStatus}
                  warnings={state.resultMeta?.warnings}
                  maskUsed={state.resultMeta?.maskUsed}
                  usedLocalRenderer={state.resultMeta?.usedLocalRenderer}
                  onDownload={() => {}}
                  onRetry={() => {
                    setWatchOverrideUrl(null);
                    dispatch({ type: "RESET_TRY_AGAIN" });
                  }}
                  onChangeProduct={() => {
                    setWatchOverrideUrl(null);
                    dispatch({ type: "RESET_TRY_AGAIN" });
                  }}
                  onClose={() => {
                    setWatchOverrideUrl(null);
                    dispatch({ type: "RESET_TRY_AGAIN" });
                  }}
                />
                {categoryId === "watch" &&
                  state.resultMeta?.renderMode === "fast-overlay" &&
                  state.userImage && (
                    <div className="mt-4">
                      <WatchAdjustPanel
                        userFile={state.userImage}
                        productFile={
                          state.products.find(
                            (p) => p.type === "image" && p.file
                          )?.file ?? null
                        }
                        productCutoutUrl={
                          state.products[0]?.cutoutUrl ?? null
                        }
                        onPreviewUrl={(url) => setWatchOverrideUrl(url)}
                        onValidate={() => {}}
                        onRefineWithAI={(composite, mask) =>
                          refineWithAI(composite, mask)
                        }
                      />
                      {refining && (
                        <p className="mt-2 text-center text-xs text-bordeaux">
                          Amélioration IA en cours… 10 à 25 secondes.
                        </p>
                      )}
                      {refineError && (
                        <p
                          className="mt-2 text-center text-xs text-bordeaux"
                          role="alert"
                        >
                          {refineError}
                        </p>
                      )}
                    </div>
                  )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Stage>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Product card */}
      {productImage && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-4 rounded-2xl border border-gold/40 bg-gradient-to-r from-gold/10 to-transparent p-4 shadow-soft"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={productImage}
            alt={productTitle ?? "Article"}
            className="h-16 w-16 rounded-xl bg-cream-dark object-cover ring-1 ring-ink/10"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.endsWith("/demo-watch-gold-green.svg")) {
                img.src = "/demo-watch-gold-green.svg";
              }
            }}
          />
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-bordeaux/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bordeaux">
              Article de la boutique
            </span>
            <p className="mt-1 truncate text-sm font-medium text-ink">
              {productTitle ?? "Article détecté automatiquement"}
            </p>
          </div>
        </motion.div>
      )}

      {/* Category indicator + change button */}
      <div className="glass-card flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bordeaux/10 text-bordeaux">
          <CategoryIcon name={category.iconName} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-ink-muted">
            Zone d&apos;essayage
          </p>
          <p className="truncate text-sm font-medium text-ink">
            {category.label}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="btn-ghost shrink-0 text-xs"
          aria-expanded={pickerOpen}
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          Changer
        </button>
      </div>

      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
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
                      "flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all",
                      isActive
                        ? "border-bordeaux bg-bordeaux/5 shadow-soft"
                        : "border-ink/10 bg-white hover:border-bordeaux/30"
                    )}
                    aria-pressed={isActive}
                  >
                    <CategoryIcon
                      name={c.iconName}
                      className={cn(
                        "h-5 w-5",
                        isActive ? "text-bordeaux" : "text-ink-muted"
                      )}
                    />
                    <span className="text-[11px] font-medium leading-tight text-ink">
                      {c.label.split(" / ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="glass-card p-5 sm:p-6">
        <PhotoGuideSteps category={category} />
      </div>

      <div className="glass-card space-y-4 p-5 sm:p-6">
        <h3 className="font-display text-lg font-semibold text-ink">
          Votre photo
        </h3>
        <ImageUploader
          previewUrl={state.userImagePreview}
          onImageSelect={(file, previewUrl) =>
            dispatch({ type: "SET_USER_IMAGE", file, previewUrl })
          }
          onImageClear={() => dispatch({ type: "CLEAR_USER_IMAGE" })}
          error={state.error}
        />
        <PhotoQualityChecklist
          file={state.userImage}
          category={category.id}
        />
        {categoryId === "hand-jewelry" && (
          <HandJewelryOptions
            type={handJewelryType}
            onTypeChange={setHandJewelryType}
            finger={ringFinger}
            onFingerChange={setRingFinger}
          />
        )}
        <MaskTestUploader value={manualMask} onChange={setManualMask} />
        <ConsentCheckbox checked={consent} onChange={setConsent} />
      </div>

      {state.error && state.status === "error" && (
        <p className="text-sm text-bordeaux" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        <LaunchButton onClick={validateAndSubmit} disabled={!consent} />
      </div>

      <PrivacyNote />
    </div>
  );
}
