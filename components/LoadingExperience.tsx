"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { Category } from "@/types";
import { ArtisanScene } from "./scenes/ArtisanScene";

interface LoadingExperienceProps {
  category: Category;
}

export function LoadingExperience({ category }: LoadingExperienceProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return p;
        return p + Math.random() * 8;
      });
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label="Génération en cours"
    >
      <div className="mx-4 max-w-md rounded-4xl bg-white p-10 shadow-lifted text-center">
        <div className="mb-6 flex justify-center">
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
            className="h-full rounded-full bg-gradient-to-r from-bordeaux to-gold"
            initial={{ width: "0%" }}
            animate={{ width: `${Math.min(progress, 95)}%` }}
            transition={{ ease: "easeOut" }}
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
                delay: i * 0.2,
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
