"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { TryOnAssistantState } from "@/types";
import { mapTryOnStageToMessage } from "@/lib/assistantProgress";

interface SimulationPanelProps {
  state: TryOnAssistantState;
}

/**
 * Replaces the noisy "Je prépare votre simulation…" + "Vous pouvez
 * réduire cette bulle…" chat bubbles during loading with a single
 * dynamic status panel. Removes the visual double-bubble effect the
 * customer reported (purple chat bubble on top of the purple bubble
 * header).
 */
export function SimulationPanel({ state }: SimulationPanelProps) {
  const stageLabel = mapTryOnStageToMessage(state.status);
  const pct = Math.min(100, Math.round(state.progress));

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-5 text-center">
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-bordeaux/15 via-fuchsia-100 to-gold/15"
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-bordeaux/30"
          animate={{ scale: [1, 1.18, 1] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <Sparkles className="h-7 w-7 text-bordeaux" aria-hidden />
      </motion.div>

      <p className="text-sm font-semibold text-ink">Simulation en cours…</p>

      <p className="min-h-[2.5em] text-xs text-ink-muted">{stageLabel}</p>

      {/* Single percentage row, no chat bubble. */}
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-3xl font-semibold text-gradient">
          {pct}
        </span>
        <span className="text-sm font-medium text-ink-muted">%</span>
      </div>

      <p className="mt-1 max-w-[260px] text-[11px] leading-snug text-ink-muted">
        Vous pouvez réduire cette bulle et continuer vos achats — je vous
        préviens dès que c’est prêt.
      </p>
    </div>
  );
}
