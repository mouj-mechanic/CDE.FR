"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface CurtainRevealProps {
  onRevealComplete?: () => void;
  children: React.ReactNode;
}

export function CurtainReveal({
  onRevealComplete,
  children,
}: CurtainRevealProps) {
  const [curtainsOpen, setCurtainsOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setCurtainsOpen(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (curtainsOpen && onRevealComplete) {
      const timer = setTimeout(onRevealComplete, 1700);
      return () => clearTimeout(timer);
    }
  }, [curtainsOpen, onRevealComplete]);

  return (
    <div className="relative min-h-[320px] overflow-hidden rounded-3xl">
      {/* Result content behind curtains */}
      <motion.div
        className="relative z-10 p-4"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={
          curtainsOpen
            ? { opacity: 1, scale: 1 }
            : { opacity: 0, scale: 0.92 }
        }
        transition={{ delay: 0.6, duration: 0.7, ease: "easeOut" }}
      >
        {children}
      </motion.div>

      {/* Left curtain */}
      <motion.div
        className="curtain-panel curtain-fold pointer-events-none absolute inset-y-0 left-0 z-20 w-[52%]"
        initial={{ x: 0 }}
        animate={curtainsOpen ? { x: "-100%" } : { x: 0 }}
        transition={{ duration: 1.6, ease: [0.4, 0, 0.2, 1] }}
        aria-hidden
      />

      {/* Right curtain */}
      <motion.div
        className="curtain-panel curtain-fold pointer-events-none absolute inset-y-0 right-0 z-20 w-[52%]"
        initial={{ x: 0 }}
        animate={curtainsOpen ? { x: "100%" } : { x: 0 }}
        transition={{ duration: 1.6, ease: [0.4, 0, 0.2, 1] }}
        aria-hidden
      />
    </div>
  );
}
