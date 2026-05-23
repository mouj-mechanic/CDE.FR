"use client";

import { useCallback, useReducer, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings2 } from "lucide-react";
import type { Category, CategoryId, ProductItem } from "@/types";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { initialTryOnState, tryOnReducer } from "@/lib/tryOnReducer";
import { PhotoGuide } from "./PhotoGuide";
import { ImageUploader } from "./ImageUploader";
import { LaunchButton } from "./LaunchButton";
import { Stage } from "./Stage";
import { LoadingScene } from "./LoadingScene";
import { ResultView } from "./ResultView";
import { CategoryIcon } from "./CategoryIcon";
import { PrivacyNote } from "./PrivacyNote";
import { cn } from "@/lib/utils";

interface EmbedFlowProps {
  initialCategoryId: CategoryId;
  product: ProductItem;
  productTitle?: string | null;
  productImage?: string | null;
}

export function EmbedFlow({
  initialCategoryId,
  product,
  productTitle,
  productImage,
}: EmbedFlowProps) {
  const [categoryId, setCategoryId] = useState<CategoryId>(initialCategoryId);
  const [pickerOpen, setPickerOpen] = useState(false);
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

    dispatch({ type: "SET_STATUS", status: "loading" });
    dispatch({ type: "SET_ERROR", error: null });

    const formData = new FormData();
    formData.append("category", categoryId);
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

    if (productTitle) formData.append("notes", `Article : ${productTitle}`);

    try {
      const response = await fetch("/api/try-on", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erreur lors de la génération.");
      }
      dispatch({ type: "SET_RESULT", resultUrl: data.resultUrl });
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
  }, [state, categoryId, productTitle]);

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
                  resultUrl={state.resultUrl}
                  onDownload={() => {}}
                  onRetry={() => dispatch({ type: "RESET_TRY_AGAIN" })}
                  onChangeProduct={() => dispatch({ type: "RESET_TRY_AGAIN" })}
                  onClose={() => dispatch({ type: "RESET_TRY_AGAIN" })}
                />
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
            className="h-16 w-16 rounded-xl object-cover ring-1 ring-ink/10 bg-cream-dark"
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

      {/* Photo guide for the auto-selected category */}
      <div className="glass-card p-5 sm:p-6">
        <PhotoGuide category={category} />
      </div>

      {/* Photo upload */}
      <div className="glass-card p-5 sm:p-6">
        <h3 className="mb-3 font-display text-lg font-semibold text-ink">
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
      </div>

      {/* Error */}
      {state.error && state.status === "error" && (
        <p className="text-sm text-bordeaux" role="alert">
          {state.error}
        </p>
      )}

      {/* Launch */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        <LaunchButton onClick={validateAndSubmit} />
      </div>

      <PrivacyNote />
    </div>
  );
}
