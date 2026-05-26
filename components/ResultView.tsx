"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  RefreshCw,
  ShoppingBag,
  RotateCcw,
  Sparkles,
  Link as LinkIcon,
  CheckCheck,
} from "lucide-react";
import { PrivacyNote } from "./PrivacyNote";
import { SparkleBurst } from "./SparkleBurst";
import { ShareMenu } from "./ShareMenu";
import { MOCK_FALLBACK } from "@/lib/mockResults";
import { brand } from "@/lib/brand";
import type {
  QualityChecks,
  QualityStatus,
  RenderMode,
  TryOnWarning,
} from "@/types";

interface ResultViewProps {
  resultUrl: string;
  onDownload: () => void;
  onRetry: () => void;
  onChangeProduct: () => void;
  onClose: () => void;
  provider?: string;
  model?: string;
  mock?: boolean;
  renderMode?: RenderMode;
  qualityStatus?: QualityStatus;
  warnings?: TryOnWarning[];
  /**
   * True when the API attached an alpha mask to the OpenAI edit call.
   * Surfaces the "Édition masquée" badge.
   */
  maskUsed?: boolean;
  /**
   * True when the displayed image came from a local (canvas / fast-overlay)
   * renderer. In API-only mode this should never be true; if it is, a
   * warning is shown so testers know the OpenAI call did not produce the
   * final result.
   */
  usedLocalRenderer?: boolean;
  /** Server-computed fidelity checks (OpenAI path). */
  qualityChecks?: QualityChecks;
  /**
   * True when the original product PNG was re-stamped on top of the AI
   * result. Surfaces the "Produit verrouillé" badge and an explanatory
   * note.
   */
  productLocked?: boolean;
}

const REVEAL_START_MS = 150;
const REVEAL_DURATION_MS = 2000;

type Phase = "waiting" | "revealing" | "done";

/**
 * Map server warnings to a single customer-facing note. We deliberately
 * hide every technical warning code from the end user: "tighten your
 * mask", "outside-mask changed", "product-lock failed", "503 from
 * provider", etc. would only confuse a shopper.
 *
 * Returns `null` when nothing user-relevant happened (silent success).
 */
function pickCustomerFacingNote(
  warnings: TryOnWarning[] | undefined,
  qualityChecks: QualityChecks | undefined,
  qualityStatus: QualityStatus | undefined,
  usedLocalRenderer: boolean | undefined
): string | null {
  // Whitelist of codes we DO want to surface gently. Anything else
  // collapses to the generic fidelity-fallback message when appropriate.
  const friendlyCodes: Record<string, string> = {
    "product-low-res":
      "Pour un rendu encore plus net, utilisez une image produit en haute résolution.",
    "user-image-low-res":
      "Pour un rendu encore plus net, prenez la photo en lumière naturelle et plus rapprochée.",
  };

  if (warnings) {
    for (const w of warnings) {
      if (friendlyCodes[w.code]) {
        return friendlyCodes[w.code];
      }
    }
  }

  // When a fallback was used (deterministic composite or anti-ghost
  // mux), reassure the customer with a single soft message.
  const usedFallback =
    qualityStatus === "fallback-preview" ||
    usedLocalRenderer === true ||
    (warnings ?? []).some(
      (w) =>
        w.code === "anti-ghost-applied" ||
        w.code === "product-fidelity-check-failed" ||
        w.code === "product-duplication-detected" ||
        w.code === "ghost-product-detected"
    );
  if (usedFallback) {
    return "Nous avons utilisé le rendu le plus fidèle pour préserver votre photo et le produit.";
  }

  // Outside-mask preservation issues never reach the customer as text
  // — the quality gate already retried / fell back upstream. If the
  // gate let the result through, we trust it.
  void qualityChecks;
  return null;
}

export function ResultView({
  resultUrl,
  onDownload,
  onRetry,
  onChangeProduct,
  onClose,
  provider,
  model,
  mock,
  renderMode,
  qualityStatus,
  warnings,
  maskUsed,
  usedLocalRenderer,
  qualityChecks,
  productLocked,
}: ResultViewProps) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [showBurst, setShowBurst] = useState(false);
  const [imgSrc, setImgSrc] = useState(resultUrl);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setImgSrc(resultUrl);
  }, [resultUrl]);

  useEffect(() => {
    const startTimer = setTimeout(() => setPhase("revealing"), REVEAL_START_MS);
    const burstTimer = setTimeout(
      () => setShowBurst(true),
      REVEAL_START_MS + REVEAL_DURATION_MS - 200
    );
    const doneTimer = setTimeout(
      () => setPhase("done"),
      REVEAL_START_MS + REVEAL_DURATION_MS
    );
    return () => {
      clearTimeout(startTimer);
      clearTimeout(burstTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  const handleDownload = useCallback(async () => {
    const isExternal = /^https?:\/\//.test(imgSrc);
    const downloadHref = isExternal
      ? `/api/download?url=${encodeURIComponent(imgSrc)}`
      : imgSrc;
    const ext = (() => {
      const m = imgSrc.match(/\.(jpe?g|png|webp|svg)(\?|$)/i);
      return m ? m[1].toLowerCase() : "jpg";
    })();
    try {
      const response = await fetch(downloadHref);
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trywithai-essayage-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onDownload();
    } catch {
      // Fallback: open in a new tab so the user can save it manually
      window.open(imgSrc, "_blank", "noopener,noreferrer");
    }
  }, [imgSrc, onDownload]);

  const handleCopyLink = useCallback(async () => {
    const isExternal = /^https?:\/\//.test(imgSrc);
    if (!isExternal) return;
    try {
      await navigator.clipboard.writeText(imgSrc);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [imgSrc]);

  const isWaiting = phase === "waiting";
  const isRevealing = phase === "revealing";
  const showProgressUI = isWaiting || isRevealing;
  const isExternalUrl = /^https?:\/\//.test(imgSrc);

  return (
    <div className="space-y-6 text-center">
      {/* Title swap */}
      <div className="relative h-16 sm:h-20">
        <AnimatePresence mode="wait">
          {showProgressUI ? (
            <motion.div
              key="revealing"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-x-0"
            >
              <p className="font-display text-lg italic text-bordeaux sm:text-xl">
                Révélation en cours…
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Composition de votre essayage
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="absolute inset-x-0 flex items-center justify-center gap-2"
            >
              <Sparkles
                className="h-5 w-5 text-gold sm:h-6 sm:w-6"
                aria-hidden
              />
              <h3 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
                Votre essayage est prêt
              </h3>
              <Sparkles
                className="h-5 w-5 text-gold sm:h-6 sm:w-6"
                aria-hidden
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Provider badge */}
      {phase === "done" && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="flex items-center justify-center"
        >
          <div className="flex flex-col items-center gap-1">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
                renderMode === "fast-overlay"
                  ? "bg-emerald-100 text-emerald-800"
                  : renderMode === "specialized-vton"
                    ? "bg-violet-100 text-violet-800"
                    : mock
                      ? "bg-amber-100 text-amber-800"
                      : "bg-gradient-to-r from-bordeaux/15 to-gold/15 text-bordeaux"
              }`}
            >
              <Sparkles className="h-3 w-3" aria-hidden />
              {renderMode === "fast-overlay"
                ? "Aperçu rapide"
                : renderMode === "specialized-vton"
                  ? "Rendu spécialisé vêtements"
                  : renderMode === "api-image-edit" ||
                      renderMode === "api-image-edit-product-lock"
                    ? "Généré avec GPT Image"
                    : renderMode === "premium-ai"
                      ? "Rendu IA premium"
                      : mock
                        ? "Mode démo"
                        : "Généré avec IA"}
              {!mock && model && renderMode !== "fast-overlay" && (
                <span className="ml-1 font-normal normal-case opacity-70">
                  · {prettyModel(model, provider)}
                </span>
              )}
            </span>

            {/* Fidelity badges — strict pipeline transparency */}
            {!mock && provider === "openai" && (
              <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                {productLocked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                    Produit verrouillé
                  </span>
                )}
                {qualityChecks?.outsideMaskPreserved === true && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-800">
                    Client préservé
                  </span>
                )}
                {maskUsed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-bordeaux/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-bordeaux">
                    Édition masquée
                  </span>
                )}
              </div>
            )}

            {productLocked && (
              <span className="mt-0.5 text-[10px] text-ink-muted/80">
                L&apos;article original a été conservé comme référence
                verrouillée.
              </span>
            )}
            {!mock &&
              provider === "fal" &&
              renderMode !== "fast-overlay" && (
                <span className="text-[10px] uppercase tracking-wider text-ink-muted/70">
                  Provider: fal.ai
                </span>
              )}
            {renderMode === "fast-overlay" &&
              qualityStatus !== "fallback-preview" && (
                <span className="text-[10px] uppercase tracking-wider text-ink-muted/70">
                  Rendu déterministe local
                </span>
              )}
            {qualityStatus === "fallback-preview" && (
              <span className="text-[11px] font-medium text-amber-800">
                Rendu IA non validé, aperçu rapide utilisé.
              </span>
            )}
            {usedLocalRenderer === true && renderMode !== "fast-overlay" && (
              <span className="text-[11px] font-medium text-amber-800">
                Attention : rendu local utilisé
              </span>
            )}
            {qualityChecks?.productFidelityWarning === true && (
              <span className="text-[11px] font-medium text-amber-800">
                Image produit basse résolution — fidélité réduite.
              </span>
            )}
          </div>
        </motion.div>
      )}

      {phase === "done" &&
        (() => {
          // Customer-facing UX: we never expose raw provider warnings
          // ("mask too tight", "outside-mask changed", "product-lock
          //  failed", etc.). They confuse non-technical users. Instead
          //  we collapse all internal warnings into a single soft
          //  message ONLY when the result actually used a quality
          //  fallback (deterministic composite or anti-ghost mux).
          //
          //  We still keep the typed `warnings` payload on the API
          //  response for QA dashboards.
          const customerFacing = pickCustomerFacingNote(
            warnings,
            qualityChecks,
            qualityStatus,
            usedLocalRenderer
          );
          if (!customerFacing) return null;
          return (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="mx-auto max-w-md rounded-xl border border-ink/10 bg-cream-light p-3 text-center text-xs text-ink/80"
            >
              {customerFacing}
            </motion.p>
          );
        })()}

      {/* Image with progressive reveal */}
      <div className="relative mx-auto max-w-lg">
        <div className="relative overflow-hidden rounded-2xl border border-ink/10 bg-cream-dark shadow-lifted ring-1 ring-bordeaux/10">
          <motion.div
            initial={{
              filter: "blur(28px) grayscale(0.9) brightness(1.05)",
              opacity: 0.4,
              scale: 1.05,
            }}
            animate={{
              filter: showProgressUI
                ? "blur(28px) grayscale(0.9) brightness(1.05)"
                : "blur(0px) grayscale(0) brightness(1)",
              opacity: 1,
              scale: 1,
            }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc}
              alt="Résultat de votre essayage virtuel"
              width={600}
              height={800}
              loading="eager"
              className="block w-full object-contain"
              onError={() => {
                if (imgSrc !== MOCK_FALLBACK) setImgSrc(MOCK_FALLBACK);
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 -z-10 animate-pulse bg-gradient-to-br from-cream-dark via-cream to-cream-dark"
              aria-hidden
            />
          </motion.div>

          <AnimatePresence>
            {phase === "revealing" && (
              <motion.div
                key="scan"
                className="pointer-events-none absolute inset-x-0 z-10 h-24"
                initial={{ top: "-20%", opacity: 0 }}
                animate={{ top: "110%", opacity: [0, 1, 1, 0.8, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 2.0, ease: "easeInOut" }}
                style={{
                  background:
                    "linear-gradient(180deg, transparent 0%, rgba(236,72,153,0.15) 35%, rgba(236,72,153,0.55) 50%, rgba(236,72,153,0.15) 65%, transparent 100%)",
                  boxShadow: "0 0 24px rgba(236, 72, 153, 0.4)",
                }}
                aria-hidden
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase === "revealing" && (
              <motion.div
                key="sweep"
                className="pointer-events-none absolute inset-y-0 z-10 w-1/3"
                initial={{ left: "-30%", opacity: 0 }}
                animate={{ left: "100%", opacity: [0, 0.6, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.8, delay: 0.3, ease: "easeInOut" }}
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                }}
                aria-hidden
              />
            )}
          </AnimatePresence>

          {showBurst && <SparkleBurst />}
        </div>

        <AnimatePresence>
          {showProgressUI && (
            <motion.div
              key="progress"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
              className="mt-4 space-y-2"
              aria-live="polite"
            >
              <div className="h-1 overflow-hidden rounded-full bg-cream-dark">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-bordeaux via-gold to-bordeaux bg-[length:200%_100%]"
                  initial={{ width: "0%" }}
                  animate={{
                    width: phase === "revealing" ? "100%" : "0%",
                    backgroundPosition: ["0% 0%", "200% 0%"],
                  }}
                  transition={{
                    width: { duration: 2, ease: "easeOut" },
                    backgroundPosition: {
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                />
              </div>
              <RevealMilestones />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Buttons */}
      <AnimatePresence>
        {phase === "done" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center"
          >
            <button
              type="button"
              onClick={handleDownload}
              className="btn-primary"
            >
              <Download className="h-5 w-5" aria-hidden />
              Télécharger
            </button>
            <ShareMenu resultUrl={imgSrc} />
            {isExternalUrl && (
              <button
                type="button"
                onClick={handleCopyLink}
                className="btn-secondary"
                aria-live="polite"
              >
                {copied ? (
                  <>
                    <CheckCheck className="h-5 w-5" aria-hidden />
                    Copié !
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-5 w-5" aria-hidden />
                    Copier le lien
                  </>
                )}
              </button>
            )}
            <button type="button" onClick={onRetry} className="btn-secondary">
              <RefreshCw className="h-5 w-5" aria-hidden />
              Réessayer
            </button>
            <button
              type="button"
              onClick={onChangeProduct}
              className="btn-secondary"
            >
              <ShoppingBag className="h-5 w-5" aria-hidden />
              Changer d&apos;article
            </button>
            <button type="button" onClick={onClose} className="btn-ghost">
              <RotateCcw className="h-5 w-5" aria-hidden />
              Nouvelle catégorie
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "done" && (
        <>
          <p className="mx-auto max-w-md text-xs italic text-ink-muted">
            Le rendu est une prévisualisation IA. Le résultat réel peut varier
            selon la photo et le produit. © {brand.name}
          </p>
          <PrivacyNote />
        </>
      )}
    </div>
  );
}

function prettyModel(model: string, provider?: string): string {
  if (model.startsWith("gpt-image")) return "GPT Image";
  if (model.includes("fashn")) return "FASHN";
  if (model.includes("flux-pro/v1/fill")) return "FLUX.1 Fill";
  if (model.includes("flux-lora/inpainting")) return "FLUX LoRA Inpaint";
  if (model.includes("kontext")) return "FLUX Kontext";
  if (provider) return provider;
  return model;
}

const MILESTONES = [
  "Analyse de votre photo",
  "Préparation de l'article",
  "Composition du rendu",
  "Finalisation",
];

function RevealMilestones() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % MILESTONES.length);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-4 items-center justify-center text-xs text-ink-muted">
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.3 }}
        >
          {MILESTONES[index]}…
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
