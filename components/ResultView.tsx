"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  RefreshCw,
  ShoppingBag,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { PrivacyNote } from "./PrivacyNote";
import { SparkleBurst } from "./SparkleBurst";

interface ResultViewProps {
  resultUrl: string;
  onDownload: () => void;
  onRetry: () => void;
  onChangeProduct: () => void;
  onClose: () => void;
}

// Wait for the curtain to open before starting the reveal sequence.
const CURTAIN_DELAY_MS = 900;
const REVEAL_DURATION_MS = 2200;

type Phase = "waiting" | "revealing" | "done";

export function ResultView({
  resultUrl,
  onDownload,
  onRetry,
  onChangeProduct,
  onClose,
}: ResultViewProps) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [showBurst, setShowBurst] = useState(false);

  useEffect(() => {
    const startTimer = setTimeout(
      () => setPhase("revealing"),
      CURTAIN_DELAY_MS
    );
    const burstTimer = setTimeout(
      () => setShowBurst(true),
      CURTAIN_DELAY_MS + REVEAL_DURATION_MS - 200
    );
    const doneTimer = setTimeout(
      () => setPhase("done"),
      CURTAIN_DELAY_MS + REVEAL_DURATION_MS
    );
    return () => {
      clearTimeout(startTimer);
      clearTimeout(burstTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  const handleDownload = useCallback(async () => {
    const isExternal = /^https?:\/\//.test(resultUrl);
    const downloadHref = isExternal
      ? `/api/download?url=${encodeURIComponent(resultUrl)}`
      : resultUrl;
    const ext = (() => {
      const m = resultUrl.match(/\.(jpe?g|png|webp|svg)(\?|$)/i);
      return m ? m[1].toLowerCase() : "png";
    })();
    try {
      const response = await fetch(downloadHref);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `essayage-cabines-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onDownload();
    } catch {
      window.open(resultUrl, "_blank");
    }
  }, [resultUrl, onDownload]);

  const isSvg = resultUrl.endsWith(".svg");
  const isWaiting = phase === "waiting";
  const isRevealing = phase === "revealing";
  const showProgressUI = isWaiting || isRevealing;

  return (
    <div className="space-y-6 text-center">
      {/* Title swap : reveal progress -> "essayage prêt" */}
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

      {/* Image with progressive reveal */}
      <div className="relative mx-auto max-w-lg">
        <div className="relative overflow-hidden rounded-2xl border border-ink/10 bg-cream-dark shadow-lifted">
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
            {isSvg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resultUrl}
                alt="Résultat de votre essayage virtuel"
                className="w-full object-contain"
              />
            ) : (
              <Image
                src={resultUrl}
                alt="Résultat de votre essayage virtuel"
                width={600}
                height={800}
                className="w-full object-contain"
                unoptimized
              />
            )}
          </motion.div>

          {/* Scan line during reveal */}
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
                    "linear-gradient(180deg, transparent 0%, rgba(201,169,110,0.15) 35%, rgba(201,169,110,0.55) 50%, rgba(201,169,110,0.15) 65%, transparent 100%)",
                  boxShadow: "0 0 24px rgba(201, 169, 110, 0.4)",
                }}
                aria-hidden
              />
            )}
          </AnimatePresence>

          {/* Vertical sweep highlight */}
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

        {/* Progress bar with milestones */}
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
              Télécharger l&apos;image
            </button>
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

      {phase === "done" && <PrivacyNote />}
    </div>
  );
}

const MILESTONES = [
  "Analyse de votre photo",
  "Préparation de l’article",
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
