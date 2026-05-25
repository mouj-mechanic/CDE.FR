"use client";

import { useReducer, useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { Category, ProductItem, TryOnResponse } from "@/types";
import { initialTryOnState, tryOnReducer } from "@/lib/tryOnReducer";
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
import { CategoryIcon } from "./CategoryIcon";
import { LaunchButton } from "./LaunchButton";

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

    const formData = new FormData();
    formData.append("category", category.id);
    formData.append("userImage", state.userImage);

    const urls = state.products
      .filter((p) => p.type === "url")
      .map((p) => p.value);
    formData.append("productUrls", JSON.stringify(urls));

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
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Erreur lors de la génération.");
      }

      dispatch({
        type: "SET_RESULT",
        resultUrl: data.resultUrl,
        meta: {
          provider: data.provider,
          model: data.model,
          mock: data.mock,
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
  }, [state, category.id, consent, merchantId]);

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
                  resultUrl={state.resultUrl}
                  provider={state.resultMeta?.provider}
                  model={state.resultMeta?.model}
                  mock={state.resultMeta?.mock}
                  onDownload={() => {}}
                  onRetry={() => dispatch({ type: "RESET_TRY_AGAIN" })}
                  onChangeProduct={() =>
                    dispatch({ type: "RESET_ARTICLES" })
                  }
                  onClose={() => {
                    dispatch({ type: "RESET_ALL" });
                    onClose();
                  }}
                />
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
                    onRemove={(id) =>
                      dispatch({ type: "REMOVE_PRODUCT", id })
                    }
                    error={
                      state.error && state.step === 3 ? state.error : null
                    }
                  />
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
