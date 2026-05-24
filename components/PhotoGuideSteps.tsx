"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { Category } from "@/types";
import { PhotoStepIllustration } from "./PhotoStepIllustration";
import { cn } from "@/lib/utils";

interface PhotoGuideStepsProps {
  category: Category;
  /** Auto-advance delay between steps (ms). */
  autoplayMs?: number;
}

const DEFAULT_AUTOPLAY_MS = 4200;

export function PhotoGuideSteps({
  category,
  autoplayMs = DEFAULT_AUTOPLAY_MS,
}: PhotoGuideStepsProps) {
  const steps = category.photoSteps;
  const total = steps.length;

  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<boolean[]>(() =>
    Array.from({ length: total }, (_, i) => i === 0)
  );
  const [playing, setPlaying] = useState(true);
  const [showAchievement, setShowAchievement] = useState(false);
  const [bumpXp, setBumpXp] = useState(0);
  const achievementShown = useRef(false);

  // Reset when category changes
  useEffect(() => {
    setActive(0);
    setSeen(Array.from({ length: total }, (_, i) => i === 0));
    setPlaying(true);
    setShowAchievement(false);
    achievementShown.current = false;
  }, [category.id, total]);

  // Mark current step as seen + maybe trigger achievement
  useEffect(() => {
    setSeen((prev) => {
      if (prev[active]) return prev;
      const next = [...prev];
      next[active] = true;
      setBumpXp((b) => b + 1);
      return next;
    });
  }, [active]);

  // Achievement when all steps viewed
  const allSeen = useMemo(() => seen.every(Boolean), [seen]);
  useEffect(() => {
    if (allSeen && !achievementShown.current) {
      achievementShown.current = true;
      setShowAchievement(true);
      setPlaying(false);
      const t = setTimeout(() => setShowAchievement(false), 2600);
      return () => clearTimeout(t);
    }
  }, [allSeen]);

  // Autoplay
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      setActive((a) => (a + 1) % total);
    }, autoplayMs);
    return () => clearTimeout(id);
  }, [active, playing, autoplayMs, total]);

  const goPrev = () => {
    setActive((a) => (a - 1 + total) % total);
    setPlaying(false);
  };
  const goNext = () => {
    setActive((a) => (a + 1) % total);
    setPlaying(false);
  };
  const goTo = (i: number) => {
    setActive(i);
    setPlaying(false);
  };

  const seenCount = seen.filter(Boolean).length;
  const xp = seenCount * 25; // 25 XP per step viewed
  const xpMax = total * 25;

  const step = steps[active];

  return (
    <div className="space-y-5">
      {/* Header with quest progress */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bordeaux/10 text-bordeaux">
          <Camera className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-xl font-semibold text-ink">
              Guide photo
            </h3>
            <span className="rounded-md bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
              Quête
            </span>
          </div>
          <p className="text-sm text-ink-muted">
            Zone cible : {category.bodyTarget} · Étape {active + 1} sur {total}
          </p>
        </div>

        {/* XP counter */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold" aria-hidden />
          <div className="relative">
            <motion.span
              key={xp}
              initial={{ scale: 1.3, color: "#C9A96E" }}
              animate={{ scale: 1, color: "#1A1410" }}
              transition={{ duration: 0.4 }}
              className="font-display text-lg font-semibold tabular-nums"
            >
              {xp}
            </motion.span>
            <span className="text-xs text-ink-muted"> / {xpMax} XP</span>

            {/* Floating "+25 XP" feedback */}
            <AnimatePresence>
              {bumpXp > 0 && (
                <motion.span
                  key={bumpXp}
                  initial={{ opacity: 0, y: 0 }}
                  animate={{ opacity: 1, y: -18 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                  onAnimationComplete={() => setBumpXp(0)}
                  className="pointer-events-none absolute -right-2 -top-2 text-xs font-bold text-gold"
                >
                  +25 XP
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* XP bar */}
      <div className="relative h-1.5 overflow-hidden rounded-full bg-cream-dark">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-bordeaux via-gold to-bordeaux bg-[length:200%_100%]"
          initial={{ width: 0 }}
          animate={{
            width: `${(seenCount / total) * 100}%`,
            backgroundPosition: ["0% 0%", "200% 0%"],
          }}
          transition={{
            width: { duration: 0.5, ease: "easeOut" },
            backgroundPosition: {
              duration: 2.4,
              repeat: Infinity,
              ease: "linear",
            },
          }}
        />
      </div>

      {/* Stepper chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {steps.map((s, i) => {
          const isActive = i === active;
          const isSeen = seen[i];
          return (
            <button
              key={s.title}
              type="button"
              onClick={() => goTo(i)}
              aria-current={isActive}
              aria-label={`Étape ${i + 1} : ${s.title}`}
              className={cn(
                "group relative flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                isActive
                  ? "border-bordeaux bg-bordeaux text-white shadow-soft"
                  : isSeen
                    ? "border-gold/40 bg-gold/10 text-ink"
                    : "border-ink/15 bg-white text-ink-muted hover:border-bordeaux/30"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  isActive
                    ? "bg-white text-bordeaux"
                    : isSeen
                      ? "bg-gold text-ink"
                      : "bg-ink/10 text-ink-muted"
                )}
              >
                {isSeen && !isActive ? (
                  <Check className="h-3 w-3" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              <span className="hidden sm:inline">{shortTitle(s.title)}</span>
            </button>
          );
        })}
      </div>

      {/* Main scene */}
      <div className="grid gap-5 lg:grid-cols-[260px_1fr] lg:items-center">
        <PhotoStepIllustration
          category={category.id}
          scene={step.scene}
          cycleKey={`${category.id}-${active}`}
        />

        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-2"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                Étape {active + 1} / {total}
              </p>
              <h4 className="font-display text-2xl font-semibold text-ink sm:text-[26px]">
                {step.title}
              </h4>
              <p className="text-sm leading-relaxed text-ink-muted sm:text-[15px]">
                {step.hint}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Controls */}
          <div className="mt-5 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goPrev}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-white text-ink transition-colors hover:border-bordeaux hover:text-bordeaux"
                aria-label="Étape précédente"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="flex h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-xs font-medium text-ink transition-colors hover:border-bordeaux hover:text-bordeaux"
                aria-pressed={playing}
                aria-label={playing ? "Mettre en pause" : "Lecture automatique"}
              >
                {playing ? (
                  <>
                    <Pause className="h-3.5 w-3.5" aria-hidden />
                    Auto
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden />
                    Lecture
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={goNext}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-white text-ink transition-colors hover:border-bordeaux hover:text-bordeaux"
                aria-label="Étape suivante"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <p className="hidden text-xs text-ink-muted sm:block">
              {playing
                ? "Lecture automatique des étapes"
                : "Cliquez sur Lecture ou ▶ pour reprendre"}
            </p>
          </div>
        </div>
      </div>

      {/* Achievement toast */}
      <AnimatePresence>
        {showAchievement && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-r from-gold/15 via-cream to-bordeaux/10 p-4 shadow-soft"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/20 text-gold">
              <Trophy className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-gold">
                Succès débloqué
              </p>
              <p className="text-sm font-medium text-ink">
                Maître du cadrage — vous maîtrisez le guide photo !
              </p>
            </div>
            {/* Sparkle confetti */}
            <SparkleRow />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function shortTitle(title: string) {
  // Aim for ~22 chars on mobile chips
  if (title.length <= 26) return title;
  return title.slice(0, 24).trimEnd() + "…";
}

function SparkleRow() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: 10 }).map((_, i) => (
        <motion.span
          key={i}
          className="absolute block h-1.5 w-1.5 rounded-full"
          style={{
            top: `${20 + Math.random() * 60}%`,
            left: `${10 + Math.random() * 80}%`,
            background:
              i % 2 === 0 ? "#C9A96E" : "#7A1F2B",
          }}
          initial={{ opacity: 0, y: 8, scale: 0.6 }}
          animate={{
            opacity: [0, 1, 0],
            y: [8, -22],
            scale: [0.6, 1.2, 0.6],
          }}
          transition={{
            duration: 1.6,
            delay: i * 0.07,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}
