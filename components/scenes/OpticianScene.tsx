"use client";

import { motion } from "framer-motion";

export function OpticianScene() {
  return (
    <svg viewBox="0 0 200 200" className="h-48 w-48" aria-hidden>
      <circle cx="100" cy="60" r="22" fill="#E8D5C4" opacity="0.6" />
      {/* Glasses frame */}
      <motion.g
        animate={{ scale: [1, 1.02, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <circle cx="82" cy="58" r="14" fill="none" stroke="#1E1B4B" strokeWidth="2.5" />
        <circle cx="118" cy="58" r="14" fill="none" stroke="#1E1B4B" strokeWidth="2.5" />
        <line x1="96" y1="58" x2="104" y2="58" stroke="#1E1B4B" strokeWidth="2" />
        <line x1="68" y1="56" x2="55" y2="52" stroke="#1E1B4B" strokeWidth="2" />
        <line x1="132" y1="56" x2="145" y2="52" stroke="#1E1B4B" strokeWidth="2" />
      </motion.g>
      {/* Optician hands */}
      <motion.path
        d="M50 70 Q65 55 80 62"
        fill="none"
        stroke="#EC4899"
        strokeWidth="3"
        strokeLinecap="round"
        animate={{ d: ["M50 70 Q65 55 80 62", "M48 68 Q63 53 78 60", "M50 70 Q65 55 80 62"] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <motion.path
        d="M150 70 Q135 55 120 62"
        fill="none"
        stroke="#EC4899"
        strokeWidth="3"
        strokeLinecap="round"
        animate={{ d: ["M150 70 Q135 55 120 62", "M152 68 Q137 53 122 60", "M150 70 Q135 55 120 62"] }}
        transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
      />
      {/* Screwdriver */}
      <motion.g
        animate={{ rotate: [-8, 8, -8] }}
        style={{ transformOrigin: "130px 75px" }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <line x1="130" y1="75" x2="155" y2="65" stroke="#7C3AED" strokeWidth="2" />
        <circle cx="157" cy="63" r="3" fill="#EC4899" />
      </motion.g>
    </svg>
  );
}
