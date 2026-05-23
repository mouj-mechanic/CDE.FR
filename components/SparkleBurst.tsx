"use client";

import { motion } from "framer-motion";

const SPARKLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const distance = 80 + Math.random() * 60;
  return {
    id: i,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    delay: Math.random() * 0.2,
    size: 4 + Math.random() * 5,
  };
});

export function SparkleBurst() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      aria-hidden
    >
      {SPARKLES.map((s) => (
        <motion.span
          key={s.id}
          className="absolute rounded-full bg-gold"
          style={{ width: s.size, height: s.size }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
          animate={{
            x: s.x,
            y: s.y,
            opacity: [0, 1, 0],
            scale: [0, 1, 0.4],
          }}
          transition={{
            duration: 1.1,
            delay: s.delay,
            ease: "easeOut",
          }}
        />
      ))}
      <motion.span
        className="absolute h-12 w-12 rounded-full bg-gold/30 blur-xl"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 2.4, 0], opacity: [0, 0.8, 0] }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />
    </div>
  );
}
