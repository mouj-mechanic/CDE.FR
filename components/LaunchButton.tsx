"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2 } from "lucide-react";

interface LaunchButtonProps {
  isLoading: boolean;
  onClick: () => void;
}

export function LaunchButton({ isLoading, onClick }: LaunchButtonProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      className="relative w-full overflow-hidden rounded-2xl bg-bordeaux px-8 py-4 font-medium text-white shadow-soft transition-shadow hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bordeaux focus-visible:ring-offset-2 disabled:cursor-progress disabled:opacity-100 sm:w-auto"
      whileHover={!isLoading ? { scale: 1.02 } : undefined}
      whileTap={!isLoading ? { scale: 0.97 } : undefined}
      animate={
        isLoading
          ? {
              boxShadow: [
                "0 0 0 0 rgba(201,169,110,0.55)",
                "0 0 0 18px rgba(201,169,110,0)",
              ],
            }
          : {}
      }
      transition={
        isLoading ? { duration: 1.4, repeat: Infinity, ease: "easeOut" } : {}
      }
      aria-live="polite"
    >
      {/* Animated shimmer when loading */}
      {isLoading && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full"
          animate={{ x: ["-100%", "200%"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          style={{
            background:
              "linear-gradient(90deg, transparent 20%, rgba(255,255,255,0.18) 50%, transparent 80%)",
          }}
        />
      )}

      <span className="relative flex items-center justify-center gap-2">
        <AnimatePresence mode="wait" initial={false}>
          {isLoading ? (
            <motion.span
              key="loading"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-2"
            >
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              Lancement de l&apos;essayage…
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-2"
            >
              <Sparkles className="h-5 w-5" aria-hidden />
              Lancer l&apos;essayage IA
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}
