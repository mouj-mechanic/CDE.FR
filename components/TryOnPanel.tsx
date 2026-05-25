"use client";

import { useReducer, useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Info } from "lucide-react";
import type {
  Category,
  FingerId,
  HandJewelryType,
  ProductItem,
  TryOnResponse,
} from "@/types";
import { initialTryOnState, tryOnReducer } from "@/lib/tryOnReducer";
import { runTryOnPipeline } from "@/lib/tryon/pipeline";
import { StepBar } from "./StepBar";
import { PhotoGuideSteps } from "./PhotoGuideSteps";
import { ImageUploader } from "./ImageUploader";
import { ProductInput } from "./ProductInput";
import { Stage } from "./Stage";
import { LoadingScene } from "./LoadingScene";
import { ResultView } from "./ResultView";
import { PrivacyNote } from "./PrivacyNote";
import { ConsentCheckbox } from "./ConsentCheckbox";
import { PhotoQualityChecklist } from "./PhotoQualityChecklist";
import { HandJewelryOptions } from "./HandJewelryOptions";
import { CategoryIcon } from "./CategoryIcon";
import { LaunchButton } from "./LaunchButton";
import { WatchAdjustPanel } from "./WatchAdjustPanel";

interface TryOnPanelProps {
  category: Category;
  onClose: () => void;
  initialProducts?: ProductItem[];
  merchantId?: string | null;
}

export function TryOnPanel({
  category,
  onClose,
  initialProducts,
  merchantId,
}: TryOnPanelProps) {
  const [state, dispatch] = useReducer(tryOnReducer, initialTryOnState);
  const [consent, setConsent] = useState(false);
  const [handJewelryType, setHandJewelryType] =
    useState<HandJewelryType>("ring");
  const [ringFinger, setRingFinger] = useState<FingerId>("ring");
  const [watchOverrideUrl, setWatchOverrideUrl] = useState<string | null>(null);

  useEffect(() => {
    if (initialProducts && initialProducts.length > 0) {
      initialProducts.forEach((product) => {
        dispatch({ type: "ADD_PRODUCT", product });
      });
      dispatch({ type: "SET_STEP", step: 2 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateAndSubmit = useCallback(async () => {
    if (!state.userImage) {
      dispatch({
        type: "SET_ERROR",
        error: "Veuillez importer une photo avant de lancer l'essayage.",
      });
      dispatch({ type: "SET_STEP", step: 2 });
      return;
    }
    if (state.products.length === 0) {
      dispatch({
        type: "SET_ERROR",
        error: "Veuillez ajouter au moins un article (lien ou image).",
      });
      return;
    }
    if (!consent) {
      dispatch({
        type: "SET_ERROR",
        error: "Veuillez accepter l'utilisation de votre photo pour générer l'aperçu.",
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
        category: category.id,
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

    const formData = new FormData();
    formData.append("category", category.id);
    formData.append("userImage", state.userImage);
    formData.append("renderModeRequest", "auto");
    formData.append("handJewelryType", handJewelryType);
    formData.append("ringFinger", ringFinger);

    if (pipelineResult?.previewBlob) {
      formData.append(
        "previewImage",
        new File([pipelineResult.previewBlob], "trywithai-preview.png", {
          type: "image/png",
        })
      );
      formData.append(
        "warnings",
        JSON.stringify(pipelineResult.warnings ?? [])
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

    state.products
      .filter((p) => p.type === "image" && p.file)
      .forEach((p) => {
        if (p.file) formData.append("productImages", p.file);
      });

    if (state.notes.trim()) {
      formData.append("notes", state.notes.trim());
    }
    if (merchantId) formData.append("merchantId", merchantId);

    try {
      const response = await fetch("/api/try-on", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as TryOnResponse & {
        error?: string;
        details?: string;
        provider?: string;
      };

      if (!response.ok) {
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
    category.id,
    consent,
    merchantId,
    handJewelryType,
    ringFinger,
  ]);

  const isLoading = state.status === "loading";
  const showStage = isLoading || !!state.resultUrl;

  return (
    <motion.div
      layoutId={`card-${category.id}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="glass-card overflow-hidden p-6 sm:p-10"
    >
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bordeaux/10 text-bordeaux">
            <CategoryIcon name={category.iconName} className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
              {category.label}
            </h2>
            <p className="text-sm text-ink-muted">{category.bodyTarget}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "RESET_ALL" });
            onClose();
          }}
          className="btn-ghost shrink-0"
          aria-label="Fermer la cabine"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {showStage ? (
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
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <ResultView
                  resultUrl={watchOverrideUrl ?? state.resultUrl}
                  provider={state.resultMeta?.provider}
                  model={state.resultMeta?.model}
                  mock={state.resultMeta?.mock}
                  renderMode={state.resultMeta?.renderMode}
                  qualityStatus={state.resultMeta?.qualityStatus}
                  warnings={state.resultMeta?.warnings}
                  onDownload={() => {}}
                  onRetry={() => {
                    setWatchOverrideUrl(null);
                    dispatch({ type: "RESET_TRY_AGAIN" });
                  }}
                  onChangeProduct={() => {
                    setWatchOverrideUrl(null);
                    dispatch({ type: "RESET_ARTICLES" });
                  }}
                  onClose={() => {
                    setWatchOverrideUrl(null);
                    dispatch({ type: "RESET_ALL" });
                    onClose();
                  }}
                />
                {category.id === "watch" &&
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
                        onValidate={(_blob) => {
                          // The overlay URL is already used as the result.
                        }}
                      />
                    </div>
                  )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Stage>
      ) : (
        <>
          <div className="mb-8">
            <StepBar currentStep={state.step} />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={state.step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {state.step === 1 && <PhotoGuideSteps category={category} />}
              {state.step === 2 && (
                <div className="space-y-4">
                  <h3 className="font-display text-xl font-semibold text-ink">
                    Votre photo
                  </h3>
                  <ImageUploader
                    previewUrl={state.userImagePreview}
                    onImageSelect={(file, previewUrl) =>
                      dispatch({ type: "SET_USER_IMAGE", file, previewUrl })
                    }
                    onImageClear={() =>
                      dispatch({ type: "CLEAR_USER_IMAGE" })
                    }
                    error={
                      state.error && state.step === 2 ? state.error : null
                    }
                  />
                  <PhotoQualityChecklist
                    file={state.userImage}
                    category={category.id}
                  />
                </div>
              )}
              {state.step === 3 && (
                <div className="space-y-6">
                  <ProductInput
                    category={category}
                    products={state.products}
                    onAdd={(product) =>
                      dispatch({ type: "ADD_PRODUCT", product })
                    }
                    onUpdate={(id, patch) =>
                      dispatch({ type: "UPDATE_PRODUCT", id, patch })
                    }
                    onRemove={(id) =>
                      dispatch({ type: "REMOVE_PRODUCT", id })
                    }
                    error={
                      state.error && state.step === 3 ? state.error : null
                    }
                  />
                  {(category.id === "watch" ||
                    category.id === "hand-jewelry" ||
                    category.id === "glasses") && (
                    <div className="flex items-start gap-2 rounded-xl border border-bordeaux/15 bg-bordeaux/5 p-3 text-xs text-ink">
                      <Info
                        className="mt-0.5 h-4 w-4 shrink-0 text-bordeaux"
                        aria-hidden
                      />
                      <p>
                        Pour les bijoux, montres et lunettes, une photo nette
                        et un produit sur fond transparent (PNG) donnent un
                        meilleur rendu.
                      </p>
                    </div>
                  )}
                  {category.id === "watch" && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <Info
                        className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                        aria-hidden
                      />
                      <p>
                        Pour un rendu réaliste, utilisez un poignet dégagé et
                        une image montre détourée avec contours propres.
                      </p>
                    </div>
                  )}
                  {category.id === "hand-jewelry" && (
                    <HandJewelryOptions
                      type={handJewelryType}
                      onTypeChange={setHandJewelryType}
                      finger={ringFinger}
                      onFingerChange={setRingFinger}
                    />
                  )}
                  <div>
                    <label
                      htmlFor="tryon-notes"
                      className="text-sm font-medium text-ink"
                    >
                      Notes pour l&apos;IA (optionnel)
                    </label>
                    <textarea
                      id="tryon-notes"
                      rows={2}
                      value={state.notes}
                      onChange={(e) =>
                        dispatch({ type: "SET_NOTES", notes: e.target.value })
                      }
                      placeholder="Ex. : porter le chapeau légèrement de côté…"
                      className="input-field mt-2 resize-none"
                    />
                  </div>
                  <ConsentCheckbox checked={consent} onChange={setConsent} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {state.error && state.status === "error" && (
            <p className="mt-4 text-sm text-bordeaux" role="alert">
              {state.error}
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              {state.step > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_STEP",
                      step: (state.step - 1) as 1 | 2,
                    })
                  }
                  className="btn-secondary"
                >
                  <ChevronLeft className="h-5 w-5" />
                  Précédent
                </button>
              )}
              {state.step < 3 && (
                <button
                  type="button"
                  onClick={() => {
                    if (state.step === 2 && !state.userImage) {
                      dispatch({
                        type: "SET_ERROR",
                        error: "Veuillez importer une photo pour continuer.",
                      });
                      return;
                    }
                    dispatch({
                      type: "SET_STEP",
                      step: (state.step + 1) as 2 | 3,
                    });
                  }}
                  className="btn-primary"
                >
                  Suivant
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </div>

            {state.step === 3 && (
              <LaunchButton onClick={validateAndSubmit} disabled={!consent} />
            )}
          </div>

          <div className="mt-6">
            <PrivacyNote />
          </div>
        </>
      )}
    </motion.div>
  );
}
