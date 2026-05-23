"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface StageProps {
  children: React.ReactNode;
}

const CURTAIN_DURATION_S = 1.3;

export function Stage({ children }: StageProps) {
  return (
    <div className="relative min-h-[440px] overflow-hidden rounded-3xl bg-cream-dark/40">
      {/* Stage content (loading scene OR result) */}
      <motion.div
        className="relative z-10 p-4 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
      >
        {children}
      </motion.div>

      {/* Left curtain — animates from x:0 immediately on mount */}
      <motion.div
        className="curtain-panel curtain-fold pointer-events-none absolute inset-y-0 left-0 z-20 w-[52%]"
        initial={{ x: 0 }}
        animate={{ x: "-100%" }}
        transition={{ duration: CURTAIN_DURATION_S, ease: [0.4, 0, 0.2, 1] }}
        aria-hidden
      />

      {/* Right curtain */}
      <motion.div
        className="curtain-panel curtain-fold pointer-events-none absolute inset-y-0 right-0 z-20 w-[52%]"
        initial={{ x: 0 }}
        animate={{ x: "100%" }}
        transition={{ duration: CURTAIN_DURATION_S, ease: [0.4, 0, 0.2, 1] }}
        aria-hidden
      />

      {/* Transition spinner — visible from click until curtain fully opens */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{
          duration: 0.5,
          delay: CURTAIN_DURATION_S * 0.85,
          ease: "easeOut",
        }}
        aria-hidden
      >
        <motion.div
          className="flex items-center justify-center rounded-full bg-bordeaux/85 p-4 shadow-glow backdrop-blur-sm"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
        >
          <Sparkles className="h-7 w-7 text-gold-light" />
        </motion.div>
      </motion.div>
    </div>
  );
}
