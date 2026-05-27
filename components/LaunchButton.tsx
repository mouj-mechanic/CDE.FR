"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface LaunchButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function LaunchButton({ onClick, disabled }: LaunchButtonProps) {
  const [pressed, setPressed] = useState(false);

  const handleClick = () => {
    if (disabled) return;
    setPressed(true);
    // Fire the click handler synchronously — the assistant bubble
    // mounts on the same tick, giving the customer immediate
    // feedback. We auto-release the local "pressed" lock after a
    // short window so a validation error doesn't leave the button
    // stuck in its loading state forever.
    onClick();
    window.setTimeout(() => setPressed(false), 1200);
  };

  const isDisabled = disabled || pressed;

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      className="relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-bordeaux via-fuchsia-500 to-gold bg-[length:200%_100%] px-8 py-4 font-semibold text-white shadow-soft transition-all duration-500 hover:bg-[position:100%_0] hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bordeaux focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      whileHover={!isDisabled ? { scale: 1.02 } : undefined}
      whileTap={!isDisabled ? { scale: 0.94 } : undefined}
      animate={
        pressed
          ? {
              scale: [1, 1.06, 1],
              boxShadow: [
                "0 0 0 0 rgba(236,72,153,0)",
                "0 0 0 14px rgba(236,72,153,0.45)",
                "0 0 0 28px rgba(236,72,153,0)",
              ],
            }
          : {}
      }
      transition={
        pressed
          ? { duration: 0.6, ease: "easeOut" }
          : { type: "spring", stiffness: 400, damping: 28 }
      }
      aria-live="polite"
    >
      {/* Light sweep on press */}
      {pressed && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          style={{
            background:
              "linear-gradient(90deg, transparent 20%, rgba(255,255,255,0.35) 50%, transparent 80%)",
          }}
        />
      )}
      <span className="relative flex items-center justify-center gap-2">
        <motion.span
          animate={pressed ? { rotate: 360, scale: 1.15 } : { rotate: 0, scale: 1 }}
          transition={
            pressed
              ? {
                  rotate: { duration: 1.2, repeat: Infinity, ease: "linear" },
                  scale: { duration: 0.4, ease: "easeOut" },
                }
              : { duration: 0.4, ease: "easeOut" }
          }
        >
          <Sparkles className="h-5 w-5" aria-hidden />
        </motion.span>
        Lancer l&apos;essayage IA
      </span>
    </motion.button>
  );
}
