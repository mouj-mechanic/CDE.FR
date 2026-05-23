"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface LaunchButtonProps {
  onClick: () => void;
}

export function LaunchButton({ onClick }: LaunchButtonProps) {
  const [pressed, setPressed] = useState(false);

  const handleClick = () => {
    setPressed(true);
    onClick();
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={pressed}
      className="relative w-full overflow-hidden rounded-2xl bg-bordeaux px-8 py-4 font-medium text-white shadow-soft transition-shadow hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bordeaux focus-visible:ring-offset-2 disabled:cursor-progress disabled:opacity-100 sm:w-auto"
      whileHover={!pressed ? { scale: 1.02 } : undefined}
      whileTap={!pressed ? { scale: 0.94 } : undefined}
      animate={
        pressed
          ? {
              scale: [1, 1.06, 1],
              boxShadow: [
                "0 0 0 0 rgba(201,169,110,0)",
                "0 0 0 14px rgba(201,169,110,0.45)",
                "0 0 0 28px rgba(201,169,110,0)",
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
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <Sparkles className="h-5 w-5" aria-hidden />
        </motion.span>
        Lancer l&apos;essayage IA
      </span>
    </motion.button>
  );
}
