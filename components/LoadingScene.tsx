"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Category } from "@/types";
import { ArtisanScene } from "./scenes/ArtisanScene";

interface LoadingSceneProps {
  category: Category;
}

const ORBITS = [
  { delay: 1.2, duration: 2.6, radius: 90 },
  { delay: 1.6, duration: 3.0, radius: 130 },
];

const PROGRESS_DELAY_MS = 2000;
const MILESTONES = [
  "Analyse de votre photo",
  "Préparation de l’article",
  "Composition du rendu",
  "Finalisation",
];

export function LoadingScene({ category }: LoadingSceneProps) {
  const [progress, setProgress] = useState(0);
  const [progressVisible, setProgressVisible] = useState(false);
  const [milestoneIndex, setMilestoneIndex] = useState(0);

  useEffect(() => {
    // Progress bar fades in only AFTER curtains have opened.
    const showTimer = setTimeout(() => setProgressVisible(true), PROGRESS_DELAY_MS);

    let interval: ReturnType<typeof setInterval> | null = null;
    const startTimer = setTimeout(() => {
      interval = setInterval(() => {
        setProgress((p) => (p >= 90 ? p : p + Math.random() * 5));
      }, 450);
    }, PROGRESS_DELAY_MS + 200);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(startTimer);
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!progressVisible) return;
    const interval = setInterval(() => {
      setMilestoneIndex((i) => (i + 1) % MILESTONES.length);
    }, 1400);
    return () => clearInterval(interval);
  }, [progressVisible]);

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

      {/* Artisan scene */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.7, ease: "easeOut" }}
        className="relative mb-4 flex justify-center"
      >
        <ArtisanScene type={category.animationType} />
      </motion.div>

      {/* Title */}
      <motion.h3
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.0, duration: 0.55, ease: "easeOut" }}
        className="font-display text-lg font-semibold text-ink sm:text-xl"
      >
        {category.loadingTitle}
      </motion.h3>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.3, duration: 0.5 }}
        className="mt-2 text-sm text-ink-muted"
      >
        {category.loadingDescription}
      </motion.p>

      {/* Progress bar — appears only AFTER curtains opened */}
      <AnimatePresence>
        {progressVisible && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="mx-auto mt-8 w-full max-w-sm"
          >
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{ transformOrigin: "left" }}
              className="h-1.5 overflow-hidden rounded-full bg-cream-dark"
            >
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-bordeaux via-gold to-bordeaux bg-[length:200%_100%]"
                initial={{ width: "0%" }}
                animate={{
                  width: `${Math.min(progress, 95)}%`,
                  backgroundPosition: ["0% 0%", "200% 0%"],
                }}
                transition={{
                  width: { ease: "easeOut", duration: 0.4 },
                  backgroundPosition: {
                    duration: 1.8,
                    repeat: Infinity,
                    ease: "linear",
                  },
                }}
              />
            </motion.div>

            {/* Milestone caption */}
            <div className="mt-3 flex h-4 items-center justify-center text-xs text-ink-muted">
              <AnimatePresence mode="wait">
                <motion.span
                  key={milestoneIndex}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.35 }}
                >
                  {MILESTONES[milestoneIndex]}…
                </motion.span>
              </AnimatePresence>
            </div>

            {/* Pulsing dots */}
            <div className="mt-4 flex justify-center gap-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-2 w-2 rounded-full bg-bordeaux/60"
                  animate={{
                    opacity: [0.3, 1, 0.3],
                    scale: [0.8, 1.2, 0.8],
                  }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
