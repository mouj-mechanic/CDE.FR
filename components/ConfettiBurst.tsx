"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ConfettiBurstProps {
  /** Increment this number to trigger a new burst. */
  trigger: number;
  /** Number of confetti pieces. */
  count?: number;
}

/**
 * Lightweight celebratory burst that plays whenever `trigger` changes.
 * No external lib — just animated divs.
 */
export function ConfettiBurst({ trigger, count = 28 }: ConfettiBurstProps) {
  const [visible, setVisible] = useState(false);
  const [pieces, setPieces] = useState<Piece[]>([]);

  useEffect(() => {
    if (trigger <= 0) return;
    setPieces(buildPieces(count));
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(t);
  }, [trigger, count]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {pieces.map((p, i) => (
            <motion.span
              key={`${trigger}-${i}`}
              className="absolute block"
              style={{
                left: "50%",
                top: "50%",
                width: p.size,
                height: p.size * 0.55,
                background: p.color,
                borderRadius: 2,
              }}
              initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
              animate={{
                x: p.x,
                y: p.y,
                rotate: p.rotate,
                opacity: [1, 1, 0],
              }}
              transition={{
                duration: 1.2 + Math.random() * 0.4,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface Piece {
  x: number;
  y: number;
  rotate: number;
  size: number;
  color: string;
}

const COLORS = [
  "#C9A96E", // gold
  "#7A1F2B", // bordeaux
  "#3B7A4E", // emerald
  "#E8C99A", // light gold
  "#FBF7F2", // cream
];

function buildPieces(count: number): Piece[] {
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 80 + Math.random() * 160;
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 40, // slight upward bias
      rotate: (Math.random() - 0.5) * 720,
      size: 6 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });
}
