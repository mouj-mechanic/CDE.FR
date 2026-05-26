"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface StageProps {
  children: React.ReactNode;
  /**
   * Skip the theatrical curtain reveal. Use this when the children
   * are themselves the "show" (e.g. an active loading scene with its
   * own animations). The customer expects to see those animations
   * IMMEDIATELY after clicking the action button — any cinematic
   * delay would just feel like the app is frozen.
   */
  skipCurtain?: boolean;
}

const CURTAIN_DURATION_S = 0.55;

export function Stage({ children, skipCurtain = false }: StageProps) {
  return (
    <div className="relative min-h-[440px] overflow-hidden rounded-3xl bg-cream-dark/40">
      {/* Stage content fades in IMMEDIATELY. When the curtain is
          skipped, the children fully take over the box. */}
      <motion.div
        className="relative z-10 p-4 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {children}
      </motion.div>

      {!skipCurtain && (
        <>
          <motion.div
            className="curtain-panel curtain-fold pointer-events-none absolute inset-y-0 left-0 z-20 w-[52%]"
            initial={{ x: 0 }}
            animate={{ x: "-100%" }}
            transition={{ duration: CURTAIN_DURATION_S, ease: [0.4, 0, 0.2, 1] }}
            aria-hidden
          />

          <motion.div
            className="curtain-panel curtain-fold pointer-events-none absolute inset-y-0 right-0 z-20 w-[52%]"
            initial={{ x: 0 }}
            animate={{ x: "100%" }}
            transition={{ duration: CURTAIN_DURATION_S, ease: [0.4, 0, 0.2, 1] }}
            aria-hidden
          />

          <motion.div
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{
              duration: 0.3,
              delay: CURTAIN_DURATION_S * 0.8,
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
        </>
      )}
    </div>
  );
}
