"use client";

import { motion } from "framer-motion";
import type { CategoryId } from "@/types";

interface PhotoGuideIllustrationProps {
  categoryId: CategoryId;
}

export function PhotoGuideIllustration({
  categoryId,
}: PhotoGuideIllustrationProps) {
  const highlight = getHighlightRegion(categoryId);

  return (
    <div
      className="relative mx-auto flex h-48 w-48 shrink-0 items-center justify-center rounded-3xl bg-cream-dark/80 sm:h-52 sm:w-52"
      aria-hidden
    >
      <svg viewBox="0 0 120 160" className="h-40 w-30 text-ink/20">
        {/* Silhouette */}
        <ellipse cx="60" cy="28" rx="22" ry="26" fill="currentColor" />
        <path
          d="M30 58 Q60 48 90 58 L95 130 Q60 140 25 130 Z"
          fill="currentColor"
        />
        {/* Highlight zone */}
        <motion.rect
          x={highlight.x}
          y={highlight.y}
          width={highlight.w}
          height={highlight.h}
          rx="4"
          fill="none"
          stroke="#7A1F2B"
          strokeWidth="2"
          strokeDasharray="4 4"
          animate={{
            opacity: [0.5, 1, 0.5],
            scale: [1, 1.02, 1],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx={highlight.x + highlight.w / 2}
          cy={highlight.y + highlight.h / 2}
          r="3"
          fill="#C9A96E"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </svg>
      <p className="absolute bottom-3 left-0 right-0 text-center text-xs font-medium text-bordeaux">
        {highlight.label}
      </p>
    </div>
  );
}

function getHighlightRegion(id: CategoryId) {
  switch (id) {
    case "headwear":
      return { x: 38, y: 4, w: 44, h: 48, label: "Tête & visage" };
    case "glasses":
      return { x: 38, y: 18, w: 44, h: 24, label: "Visage de face" };
    case "watch":
      return { x: 72, y: 88, w: 28, h: 28, label: "Poignet" };
    case "hand-jewelry":
      return { x: 68, y: 95, w: 32, h: 36, label: "Main" };
    case "clothes":
      return { x: 28, y: 52, w: 64, h: 78, label: "Corps / buste" };
    default:
      return { x: 28, y: 52, w: 64, h: 78, label: "Zone cible" };
  }
}
