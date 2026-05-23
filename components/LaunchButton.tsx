"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface LaunchButtonProps {
  layoutId: string;
  onClick: () => void;
}

export function LaunchButton({ layoutId, onClick }: LaunchButtonProps) {
  return (
    <motion.button
      type="button"
      layoutId={layoutId}
      onClick={onClick}
      className="relative w-full overflow-hidden rounded-2xl bg-bordeaux px-8 py-4 font-medium text-white shadow-soft transition-shadow hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bordeaux focus-visible:ring-offset-2 sm:w-auto"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
    >
      <span className="relative flex items-center justify-center gap-2">
        <Sparkles className="h-5 w-5" aria-hidden />
        Lancer l&apos;essayage IA
      </span>
    </motion.button>
  );
}
