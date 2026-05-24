"use client";

import { motion } from "framer-motion";

export function JewelerScene() {
  return (
    <svg viewBox="0 0 200 200" className="h-48 w-48" aria-hidden>
      <circle cx="100" cy="55" r="18" fill="#4A4038" opacity="0.3" />
      <rect x="85" y="72" width="30" height="50" rx="8" fill="#4A4038" opacity="0.25" />
      {/* Hand */}
      <path
        d="M55 130 Q70 120 85 125 L90 145 Q75 150 60 145 Z"
        fill="#E8D5C4"
        stroke="#EC4899"
        strokeWidth="1"
      />
      {/* Ring */}
      <motion.circle
        cx="78"
        cy="132"
        r="10"
        fill="none"
        stroke="#EC4899"
        strokeWidth="2"
        animate={{ scale: [1, 1.1, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      {/* Polishing cloth motion */}
      <motion.ellipse
        cx="95"
        cy="128"
        rx="12"
        ry="6"
        fill="#A855F7"
        opacity="0.4"
        animate={{ x: [0, 8, 0], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 1.8, repeat: Infinity }}
      />
      <motion.path
        d="M100 115 Q115 105 125 115"
        fill="none"
        stroke="#EC4899"
        strokeWidth="2"
        strokeLinecap="round"
        animate={{ rotate: [-5, 5, -5] }}
        style={{ transformOrigin: "110px 115px" }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </svg>
  );
}
