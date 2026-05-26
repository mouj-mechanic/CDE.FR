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
import {
  compressImageBlob,
  compressImageFile,
} from "@/lib/clientImageCompression";
import { safeFetchJson } from "@/lib/safeFetchJson";
import { StepBar } from "./StepBar";
import { PhotoInstructionSingle } from "./PhotoInstructionSingle";
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
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

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

    // ── Critical UX: yield to the browser BEFORE the heavy pipeline.
    // The next pipeline call decodes images, runs MediaPipe, refines
    // alpha, composites canvases — all CPU-bound work that can block
    // the UI thread for 1–2 seconds. Without an explicit yield, the
    // browser never gets a chance to paint the loading scene before
    // that work starts, so the customer sees nothing happening after
    // clicking the button. Two animation frames are enough to let
    // React commit the "loading" status and Framer-Motion start its
    // entry animation.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

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

    // Dev-only diagnostics. Useful when debugging "mask spills onto
    // fingers" / "watch too big" reports. Never exposed to the customer.
    if (process.env.NODE_ENV !== "production" && pipelineResult) {
      console.info(
        "[tryon][dev] pipeline=",
        {
          autoMaskGenerated: Boolean(pipelineResult.maskBlob),
          compositeGenerated: Boolean(pipelineResult.previewBlob),
          productAlphaDetected: pipelineResult.productHasAlpha,
          renderMode: pipelineResult.renderMode,
          placementScale: pipelineResult.watchPlacement?.scale,
          placementRotation: pipelineResult.watchPlacement?.rotation,
          placementBBox: pipelineResult.watchPlacement
            ? {
                x: pipelineResult.watchPlacement.x,
                y: pipelineResult.watchPlacement.y,
                w: pipelineResult.watchPlacement.width,
                h: pipelineResult.watchPlacement.height,
              }
            : null,
        }
      );
    }

    // Shrink large images before uploading so we never trip Vercel's 4.5 MB
    // serverless body limit (which returns plain-text "Request Entity Too
    // Large", causing JSON.parse to fail on the client).
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

    // Composite + mask: PNG, alpha-preserving, never re-encoded as JPEG.
    // We downsample the composite to a reasonable cap (1280 px on the
    // longest side) so the payload stays under Vercel's 4.5 MB cap, but
    // we keep the lossless PNG encoding so the customer's pose, the
    // product silhouette and the contact band reach the server intact.
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
        // Resize the mask to the SAME max dim as the composite so the
        // pair stays dimensionally consistent on the server.
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
    formData.append("category", category.id);
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
          // Keep PNG if alpha was already preserved upstream; otherwise
          // re-encode to JPEG. The cutout flow uploads to fal storage via
          // /api/product/cutout, so this only applies to direct uploads.
          mimeType: file.type === "image/png" ? "image/png" : "image/jpeg",
          skipIfSmallerThan: 1.2 * 1024 * 1024,
        });
      } catch (err) {
        console.warn("[tryon] product image compression failed", err);
      }
      formData.append("productImages", upload);
    }

    if (state.notes.trim()) {
      formData.append("notes", state.notes.trim());
    }
    if (merchantId) formData.append("merchantId", merchantId);

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
      // If the API ever shipped a usable resultUrl (e.g. graceful
      // deterministic fallback returned with `ok:false` for analytics
      // reasons), prefer SHOWING the image over surfacing a raw error
      // to the customer. Only block when there is truly nothing to
      // display.
      const hasShowableResult = Boolean(data.resultUrl);
      if (!result.ok && !hasShowableResult) {
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
        // We never echo back internal error strings — they leak
        // implementation details ("Mask is too small", "outside-mask
        // preservation failed", "OpenAI image edit failed", …). The
        // customer sees a single, actionable line.
        throw new Error(
          "Le rendu IA n'a pas pu être généré. Veuillez réessayer ou importer une autre photo."
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

  /**
   * Trigger the FLUX Fill refinement on the current overlay.
   *
   *  - Sends `compositeImage` (current canvas output) and `maskImage`
   *    (contact-band) generated by the client.
   *  - Sets `useInpainting=true` so the API routes to falInpaint instead
   *    of FLUX Kontext.
   *  - Falls back gracefully to the composite if the server returns an
   *    error or a non-JSON response.
   */
  const refineWithAI = useCallback(
    async (composite: Blob, mask: Blob) => {
      if (!state.userImage) return;
      setRefineError(null);
      setRefining(true);
      try {
        const fd = new FormData();
        fd.append("category", category.id);
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

        // Composite must stay sharp → PNG, no further re-encoding here.
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

        // Forward the original product files / URLs so the server can keep
        // them in its debug payload (and so usage tracking stays accurate).
        state.products
          .filter((p) => p.type === "image" && p.file)
          .forEach((p) => {
            if (p.file) fd.append("productImages", p.file);
          });
        const urls = state.products
          .filter((p) => p.type === "url")
          .map((p) => p.value);
        fd.append("productUrls", JSON.stringify(urls));
        const cutoutUrls = state.products
          .map((p) => p.cutoutUrl)
          .filter((u): u is string => Boolean(u));
        if (cutoutUrls.length) {
          fd.append("productCutoutUrls", JSON.stringify(cutoutUrls));
        }

        if (merchantId) fd.append("merchantId", merchantId);

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
        // Same rule as the primary try-on: if the API returned a
        // usable `resultUrl` we display it (deterministic fallback)
        // instead of surfacing a technical error.
        if (!result.ok && !result.data.resultUrl) {
          throw new Error(
            "Le rendu IA n'a pas pu être affiné. Réessayez ou changez de photo."
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
            qualityChecks: result.data.qualityChecks,
          },
        });
        setWatchOverrideUrl(null);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Erreur lors du raffinement IA.";
        setRefineError(msg);
      } finally {
        setRefining(false);
      }
    },
    [
      state.userImage,
      state.products,
      category.id,
      merchantId,
      handJewelryType,
      ringFinger,
    ]
  );

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
                  maskUsed={state.resultMeta?.maskUsed}
                  usedLocalRenderer={state.resultMeta?.usedLocalRenderer}
                  qualityChecks={state.resultMeta?.qualityChecks}
                  productLocked={state.resultMeta?.productLocked}
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
              {state.step === 1 && (
                <PhotoInstructionSingle category={category} />
              )}
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
                    preferredFacingMode={
                      // Wrist / hand / head accessories work best with
                      // the rear camera. Selfie cam for glasses where
                      // the customer typically points the phone at
                      // their own face.
                      category.id === "glasses" ? "user" : "environment"
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
