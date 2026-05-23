"use client";

import { motion } from "framer-motion";

export function HatmakerScene() {
  return (
    <svg viewBox="0 0 200 200" className="h-48 w-48" aria-hidden>
      {/* Person */}
      <circle cx="100" cy="55" r="18" fill="#4A4038" opacity="0.3" />
      <rect x="85" y="72" width="30" height="50" rx="8" fill="#4A4038" opacity="0.25" />
      {/* Hat */}
      <motion.g
        animate={{ y: [0, -4, 0], rotate: [-2, 2, -2] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <ellipse cx="100" cy="95" rx="35" ry="8" fill="#7A1F2B" />
        <path d="M75 95 Q100 60 125 95" fill="#9B2D3C" />
        <rect x="88" y="88" width="24" height="12" rx="2" fill="#5C1720" />
      </motion.g>
      {/* Hands adjusting */}
      <motion.path
        d="M60 100 Q75 85 90 95"
        fill="none"
        stroke="#C9A96E"
        strokeWidth="3"
        strokeLinecap="round"
        animate={{ d: ["M60 100 Q75 85 90 95", "M58 98 Q73 83 88 93", "M60 100 Q75 85 90 95"] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      <motion.path
        d="M140 100 Q125 85 110 95"
        fill="none"
        stroke="#C9A96E"
        strokeWidth="3"
        strokeLinecap="round"
        animate={{ d: ["M140 100 Q125 85 110 95", "M142 98 Q127 83 112 93", "M140 100 Q125 85 110 95"] }}
        transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
      />
    </svg>
  );
}
