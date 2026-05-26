"use client";

import { motion } from "framer-motion";
import { Camera } from "lucide-react";
import type { Category } from "@/types";

interface PhotoInstructionSingleProps {
  category: Category;
}

/**
 * Single-instruction photo guide. Replaces the legacy 4-step animated
 * `PhotoGuideSteps` UI on purpose: less to read, no distracting
 * illustrations, no media to host — just one clear directive so the
 * customer can take their photo in one go.
 *
 * Visual hierarchy:
 *   - Icon + "Votre photo" eyebrow
 *   - Body target (e.g. "Poignet ou main")
 *   - The single, action-oriented instruction sentence
 */
export function PhotoInstructionSingle({
  category,
}: PhotoInstructionSingleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-start gap-4 rounded-2xl border border-bordeaux/15 bg-white/80 p-5 shadow-soft backdrop-blur-md sm:p-6"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bordeaux/10 text-bordeaux">
        <Camera className="h-5 w-5" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Votre photo
        </p>
        <h3 className="mt-1 font-display text-xl font-semibold text-ink sm:text-2xl">
          {category.bodyTarget}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink sm:text-[15px]">
          {category.photoSingleInstruction}
        </p>
      </div>
    </motion.div>
  );
}
