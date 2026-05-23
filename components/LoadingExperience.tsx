"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { Category } from "@/types";
import { ArtisanScene } from "./scenes/ArtisanScene";

interface LoadingExperienceProps {
  category: Category;
  layoutId: string;
}

const ORBITS = [
  { delay: 0, duration: 2.2, radius: 80 },
  { delay: 0.4, duration: 2.6, radius: 110 },
  { delay: 0.8, duration: 3.0, radius: 65 },
];

export function LoadingExperience({ category, layoutId }: LoadingExperienceProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return p;
        return p + Math.random() * 6;
      });
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label="Génération en cours"
    >
      {/* Morph shell: grows from the launch button position */}
      <motion.div
        layoutId={layoutId}
        transition={{
          type: "spring",
          stiffness: 280,
          damping: 32,
          mass: 0.9,
        }}
        className="relative mx-4 w-full max-w-md overflow-hidden rounded-4xl bg-white p-10 text-center shadow-lifted"
      >
        {/* Pulsing rings */}
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          {ORBITS.map((orbit, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full border border-gold/30"
              style={{ width: orbit.radius * 2, height: orbit.radius * 2 }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                scale: [0.8, 1.15, 0.8],
                opacity: [0, 0.45, 0],
              }}
              transition={{
                duration: orbit.duration,
                delay: 0.25 + orbit.delay,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>

        {/* Inner content fades in after morph completes */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.45, ease: "easeOut" }}
        >
          <div className="relative mb-6 flex justify-center">
            <ArtisanScene type={category.animationType} />
          </div>

          <h3 className="font-display text-xl font-semibold text-ink">
            {category.loadingTitle}
          </h3>
          <p className="mt-2 text-sm text-ink-muted">
            {category.loadingDescription}
          </p>

          <div className="mt-8 h-1.5 overflow-hidden rounded-full bg-cream-dark">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-bordeaux via-gold to-bordeaux bg-[length:200%_100%]"
              initial={{ width: "0%" }}
              animate={{
                width: `${Math.min(progress, 95)}%`,
                backgroundPosition: ["0% 0%", "200% 0%"],
              }}
              transition={{
                width: { ease: "easeOut" },
                backgroundPosition: {
                  duration: 1.8,
                  repeat: Infinity,
                  ease: "linear",
                },
              }}
            />
          </div>

          <div className="mt-6 flex justify-center gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-2 w-2 rounded-full bg-bordeaux/60"
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  delay: 0.4 + i * 0.2,
                }}
              />
            ))}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
