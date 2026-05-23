"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function Hero() {
  const scrollToCabines = () => {
    document.getElementById("cabines")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-30">
        <svg
          viewBox="0 0 400 200"
          className="h-64 w-full max-w-2xl text-bordeaux/20"
          aria-hidden
        >
          <path
            d="M0 180 Q100 80 200 100 T400 180 L400 200 L0 200 Z"
            fill="currentColor"
          />
          <path
            d="M50 160 Q150 60 200 80 Q250 60 350 160"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.5"
          />
        </svg>
      </div>

      <div className="relative mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-white/60 px-4 py-1.5 text-sm text-ink-muted backdrop-blur-sm">
            <Sparkles className="h-4 w-4 text-gold" aria-hidden />
            <span>Cabine d&apos;essayage virtuelle — sans compte</span>
          </div>

          <h1 className="font-display text-4xl font-semibold leading-tight text-ink text-balance sm:text-5xl lg:text-6xl">
            Votre cabine d&apos;essayage virtuelle
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-muted sm:text-xl">
            Importez votre photo, ajoutez un article, laissez l&apos;IA vous
            montrer le résultat.
          </p>

          <motion.button
            type="button"
            onClick={scrollToCabines}
            className="btn-primary mt-10 text-lg"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Commencer l&apos;essayage
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
