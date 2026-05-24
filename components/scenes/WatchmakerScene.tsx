"use client";

import { motion } from "framer-motion";

export function WatchmakerScene() {
  return (
    <svg viewBox="0 0 200 200" className="h-48 w-48" aria-hidden>
      <circle cx="100" cy="55" r="18" fill="#4A4038" opacity="0.3" />
      <rect x="85" y="72" width="30" height="50" rx="8" fill="#4A4038" opacity="0.25" />
      {/* Loupe */}
      <motion.circle
        cx="130"
        cy="110"
        r="18"
        fill="none"
        stroke="#EC4899"
        strokeWidth="2"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <motion.line
        x1="145"
        y1="125"
        x2="160"
        y2="145"
        stroke="#EC4899"
        strokeWidth="2"
        animate={{ rotate: [0, 5, 0] }}
        style={{ transformOrigin: "145px 125px" }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      {/* Watch on wrist */}
      <motion.g
        animate={{ rotate: [-3, 3, -3] }}
        style={{ transformOrigin: "75px 130px" }}
        transition={{ duration: 2.5, repeat: Infinity }}
      >
        <ellipse cx="75" cy="130" rx="22" ry="10" fill="#7C3AED" opacity="0.3" />
        <rect x="62" y="118" width="26" height="22" rx="4" fill="#1E1B4B" />
        <circle cx="75" cy="129" r="8" fill="#EC4899" opacity="0.8" />
        <motion.line
          x1="75"
          y1="129"
          x2="75"
          y2="123"
          stroke="#7C3AED"
          strokeWidth="1.5"
          animate={{ rotate: 360 }}
          style={{ transformOrigin: "75px 129px" }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        />
      </motion.g>
    </svg>
  );
}
