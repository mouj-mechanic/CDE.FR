"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, Circle, Sparkles, ShieldCheck } from "lucide-react";
import type { Category } from "@/types";
import { ArtisanScene } from "./scenes/ArtisanScene";

interface LoadingSceneProps {
  category: Category;
}

/**
 * Loading scene shown while the try-on pipeline runs.
 *
 *  Goals:
 *    1. Make the wait feel SHORT — animations, tips, scene depth.
 *    2. Make the wait feel COMPETENT — visible pipeline checklist
 *       that progresses through real stages.
 *    3. Keep the customer ON the page — beforeunload guard +
 *       "ne quittez pas" reassurance message.
 *
 *  We don't have real progress events from the server (we'd need
 *  SSE for that). Instead we model the typical pipeline as a
 *  fixed-duration timeline that ramps to ~92 % and waits there
 *  until the actual response arrives. The user perceives steady
 *  forward motion, never a stuck bar.
 */

const ORBITS = [
  { delay: 0.05, duration: 2.6, radius: 90 },
  { delay: 0.25, duration: 3.0, radius: 130 },
];

const PROGRESS_DELAY_MS = 300;

interface StageDef {
  id: string;
  label: string;
  description: string;
  /** Cumulative end percentage when this stage completes. */
  endPct: number;
  /** Approx. duration the customer perceives for this stage (ms). */
  duration: number;
}

const STAGES: StageDef[] = [
  {
    id: "analyze",
    label: "Analyse de votre photo",
    description: "Détection du poignet et de la main",
    endPct: 18,
    duration: 2200,
  },
  {
    id: "prep",
    label: "Préparation du produit",
    description: "Découpe alpha et raffinement des bords",
    endPct: 38,
    duration: 2800,
  },
  {
    id: "place",
    label: "Placement anatomique",
    description: "Alignement avec l’axe poignet-avant-bras",
    endPct: 58,
    duration: 2800,
  },
  {
    id: "render",
    label: "Rendu déterministe",
    description: "Composition image + ombre de contact",
    endPct: 78,
    duration: 3000,
  },
  {
    id: "finish",
    label: "Vérification qualité",
    description: "Contrôle de fidélité et anti-fantôme",
    endPct: 92,
    duration: 3200,
  },
];

const TIPS = [
  {
    icon: Sparkles,
    text: "Notre IA respecte 100 % la fidélité du produit original.",
  },
  {
    icon: ShieldCheck,
    text: "Vos photos ne sont jamais stockées sans votre accord.",
  },
  {
    icon: Sparkles,
    text: "Astuce : une lumière naturelle améliore beaucoup le rendu.",
  },
  {
    icon: ShieldCheck,
    text: "Le rendu sera prêt en quelques secondes — restez sur cette page.",
  },
  {
    icon: Sparkles,
    text: "Vous pouvez ajuster manuellement le placement après le rendu.",
  },
  {
    icon: ShieldCheck,
    text: "Un avant-bras visible améliore la précision du placement.",
  },
];

export function LoadingScene({ category }: LoadingSceneProps) {
  const [progress, setProgress] = useState(0);
  const [progressVisible, setProgressVisible] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startTimeRef = useRef<number>(Date.now());

  // ── Stage-driven progress timeline ──────────────────────────────
  // We compute a real progress value from the elapsed time against
  // the cumulative stage durations. The bar advances smoothly and
  // is "anchored" to a meaningful pipeline event at every step.
  useEffect(() => {
    const showTimer = setTimeout(
      () => setProgressVisible(true),
      PROGRESS_DELAY_MS
    );
    startTimeRef.current = Date.now();

    let raf: number | null = null;
    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      setElapsedSec(Math.floor(elapsed / 1000));
      const tInStages = Math.max(0, elapsed - PROGRESS_DELAY_MS);
      // Find the current stage based on cumulative duration.
      let acc = 0;
      let stageIdx = STAGES.length - 1;
      let pctPrev = 0;
      let pctTarget = STAGES[STAGES.length - 1].endPct;
      for (let i = 0; i < STAGES.length; i++) {
        const stage = STAGES[i];
        if (tInStages < acc + stage.duration) {
          stageIdx = i;
          pctPrev = i === 0 ? 0 : STAGES[i - 1].endPct;
          pctTarget = stage.endPct;
          break;
        }
        acc += stage.duration;
      }
      setCurrentStage(stageIdx);
      // Smooth ease-out within the current stage. We cap at 92 % so
      // the bar never finishes before the actual API response.
      const stageDuration = STAGES[stageIdx]?.duration ?? 1;
      const ratio = Math.max(0, Math.min(1, (tInStages - acc) / stageDuration));
      const eased = 1 - Math.pow(1 - ratio, 2);
      const newProgress = pctPrev + (pctTarget - pctPrev) * eased;
      setProgress((p) => Math.max(p, Math.min(newProgress, 92)));
      raf = requestAnimationFrame(tick);
    };
    const timeoutId = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, PROGRESS_DELAY_MS);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(timeoutId);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  // ── Tip rotation — distract the customer ────────────────────────
  useEffect(() => {
    if (!progressVisible) return;
    const interval = setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, 3200);
    return () => clearInterval(interval);
  }, [progressVisible]);

  // ── Refresh / close warning ─────────────────────────────────────
  // While the pipeline is running we ask the browser to confirm
  // before navigating away. Modern browsers ignore custom strings
  // but they still show their own "Reload site?" dialog.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "Votre rendu est en cours de génération. Si vous quittez la page, vous devrez recommencer.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const etaSec = Math.max(0, 15 - elapsedSec);

  return (
    <div className="relative px-4 py-8 text-center sm:px-6 sm:py-10">
      {/* Pulsing rings around the artisan */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden
      >
        {ORBITS.map((orbit, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full border border-gold/30"
            style={{ width: orbit.radius * 2, height: orbit.radius * 2 }}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{
              scale: [0.8, 1.15, 0.8],
              opacity: [0, 0.45, 0],
            }}
            transition={{
              duration: orbit.duration,
              delay: orbit.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Floating sparkle particles for distraction */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.span
            key={i}
            className="absolute h-1.5 w-1.5 rounded-full bg-gold/70"
            style={{
              left: `${15 + i * 18}%`,
              top: `${20 + (i % 3) * 25}%`,
            }}
            animate={{
              y: [0, -30, 0],
              opacity: [0, 1, 0],
              scale: [0.5, 1.2, 0.5],
            }}
            transition={{
              duration: 3 + i * 0.4,
              repeat: Infinity,
              delay: i * 0.6,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Artisan scene — appears IMMEDIATELY on click. No delay. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative mb-4 flex justify-center"
      >
        <ArtisanScene type={category.animationType} />
      </motion.div>

      {/* Title — also immediate. */}
      <motion.h3
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.35, ease: "easeOut" }}
        className="font-display text-lg font-semibold text-ink sm:text-xl"
      >
        {category.loadingTitle}
      </motion.h3>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.35 }}
        className="mt-2 text-sm text-ink-muted"
      >
        {category.loadingDescription}
      </motion.p>

      {/* Progress bar + stage list — appears AFTER curtains opened */}
      <AnimatePresence>
        {progressVisible && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="mx-auto mt-8 w-full max-w-md"
          >
            {/* Progress bar with shimmer */}
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{ transformOrigin: "left" }}
              className="h-2 overflow-hidden rounded-full bg-cream-dark"
            >
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-bordeaux via-gold to-bordeaux bg-[length:200%_100%]"
                initial={{ width: "0%" }}
                animate={{
                  width: `${Math.min(progress, 95)}%`,
                  backgroundPosition: ["0% 0%", "200% 0%"],
                }}
                transition={{
                  width: { ease: "easeOut", duration: 0.5 },
                  backgroundPosition: {
                    duration: 1.8,
                    repeat: Infinity,
                    ease: "linear",
                  },
                }}
              />
            </motion.div>

            {/* Percentage + ETA row */}
            <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
              <span className="tabular-nums">
                {Math.round(progress)}%
              </span>
              <span className="tabular-nums">
                {etaSec > 0
                  ? `Environ ${etaSec}s restantes`
                  : "Presque terminé…"}
              </span>
            </div>

            {/* Stage checklist */}
            <ul className="mt-5 space-y-2 text-left text-sm">
              {STAGES.map((stage, idx) => {
                const status =
                  idx < currentStage
                    ? "done"
                    : idx === currentStage
                      ? "active"
                      : "pending";
                return (
                  <motion.li
                    key={stage.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * idx, duration: 0.3 }}
                    className="flex items-start gap-3"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                      {status === "done" ? (
                        <motion.span
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.3 }}
                        >
                          <CheckCircle2
                            className="h-5 w-5 text-bordeaux"
                            aria-hidden
                          />
                        </motion.span>
                      ) : status === "active" ? (
                        <Loader2
                          className="h-5 w-5 animate-spin text-gold"
                          aria-hidden
                        />
                      ) : (
                        <Circle
                          className="h-5 w-5 text-ink-muted/40"
                          aria-hidden
                        />
                      )}
                    </span>
                    <div className="flex-1">
                      <p
                        className={
                          status === "active"
                            ? "font-medium text-ink"
                            : status === "done"
                              ? "text-ink-muted line-through decoration-bordeaux/30"
                              : "text-ink-muted/70"
                        }
                      >
                        {stage.label}
                      </p>
                      {status === "active" && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-xs text-ink-muted"
                        >
                          {stage.description}
                        </motion.p>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </ul>

            {/* Rotating "did you know" tip */}
            <div className="mt-6 flex min-h-[3.5rem] items-center justify-center rounded-2xl bg-bordeaux/5 px-4 py-3 text-xs text-ink-muted">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tipIndex}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.4 }}
                  className="flex items-center gap-2"
                >
                  {(() => {
                    const TipIcon = TIPS[tipIndex].icon;
                    return (
                      <TipIcon
                        className="h-3.5 w-3.5 shrink-0 text-bordeaux"
                        aria-hidden
                      />
                    );
                  })()}
                  <span>{TIPS[tipIndex].text}</span>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Stay-on-page nudge */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.6, duration: 0.5 }}
              className="mt-4 text-center text-[11px] text-ink-muted/80"
            >
              Ne quittez pas cette page — votre rendu arrive dans quelques
              secondes.
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
