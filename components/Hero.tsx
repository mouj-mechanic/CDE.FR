"use client";

import { motion } from "framer-motion";
import { Sparkles, Wand2 } from "lucide-react";

export function Hero() {
  const scrollToCabines = () => {
    document.getElementById("cabines")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="relative overflow-hidden px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="relative mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-bordeaux/20 bg-white/80 px-4 py-1.5 text-sm font-medium text-bordeaux shadow-soft backdrop-blur-sm"
          >
            <Sparkles className="h-4 w-4 text-gold" aria-hidden />
            <span>Cabine d&apos;essayage virtuelle — sans compte</span>
          </motion.div>

          <h1 className="font-display text-4xl font-bold leading-[1.05] text-balance sm:text-6xl lg:text-7xl">
            <span className="text-ink">Votre cabine </span>
            <span className="text-gradient">d&apos;essayage</span>
            <br />
            <span className="text-gradient">virtuelle</span>
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-lg text-ink-muted sm:text-xl">
            Importez votre photo, ajoutez un article,{" "}
            <span className="font-semibold text-bordeaux">
              laissez l&apos;IA
            </span>{" "}
            vous montrer le résultat.
          </p>

          <motion.button
            type="button"
            onClick={scrollToCabines}
            className="btn-primary mt-10 text-lg"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            <Wand2 className="h-5 w-5" aria-hidden />
            Commencer l&apos;essayage
          </motion.button>

          {/* Trio of trust badges */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 backdrop-blur-sm ring-1 ring-bordeaux/10">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Sans inscription
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 backdrop-blur-sm ring-1 ring-gold/30">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              Photo non conservée
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 backdrop-blur-sm ring-1 ring-bordeaux/10">
              <span className="h-1.5 w-1.5 rounded-full bg-bordeaux" />
              Résultat en moins d&apos;une minute
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
