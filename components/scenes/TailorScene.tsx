"use client";

import { motion } from "framer-motion";

export function TailorScene() {
  return (
    <svg viewBox="0 0 200 200" className="h-48 w-48" aria-hidden>
      {/* Mannequin */}
      <ellipse cx="100" cy="50" rx="15" ry="18" fill="#E8D5C4" opacity="0.6" />
      <path
        d="M75 70 Q100 65 125 70 L120 150 Q100 155 80 150 Z"
        fill="#F3EBE0"
        stroke="#C9A96E"
        strokeWidth="1"
      />
      {/* Measuring tape */}
      <motion.path
        d="M70 90 Q100 85 130 90"
        fill="none"
        stroke="#7A1F2B"
        strokeWidth="2"
        strokeDasharray="4 4"
        animate={{ pathLength: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      {/* Tailor figure */}
      <circle cx="145" cy="70" r="12" fill="#4A4038" opacity="0.3" />
      <rect x="135" y="82" width="20" height="35" rx="5" fill="#4A4038" opacity="0.25" />
      <motion.line
        x1="145"
        y1="95"
        x2="120"
        y2="100"
        stroke="#C9A96E"
        strokeWidth="2"
        animate={{ rotate: [-3, 3, -3] }}
        style={{ transformOrigin: "145px 95px" }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <motion.line
        x1="70"
        y1="120"
        x2="70"
        y2="145"
        stroke="#7A1F2B"
        strokeWidth="1.5"
        animate={{ y1: [120, 125, 120] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
    </svg>
  );
}
