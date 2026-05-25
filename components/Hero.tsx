"use client";

import { motion } from "framer-motion";
import { Sparkles, Wand2, ShoppingBag } from "lucide-react";
import { brand } from "@/lib/brand";

export function Hero() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
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
            <span>{brand.positioningFr}</span>
          </motion.div>

          <h1 className="font-display text-4xl font-bold leading-[1.05] text-balance sm:text-6xl lg:text-7xl">
            <span className="text-gradient">{brand.tagline}</span>
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-lg text-ink-muted sm:text-xl">
            Ajoutez un{" "}
            <span className="font-semibold text-bordeaux">
              widget d&apos;essayage virtuel IA
            </span>{" "}
            à votre boutique Shopify et aidez vos clients à acheter avec
            confiance.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <motion.button
              type="button"
              onClick={() => scrollTo("demo")}
              className="btn-primary text-lg"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              <Wand2 className="h-5 w-5" aria-hidden />
              Voir la démo
            </motion.button>
            <motion.button
              type="button"
              onClick={() => scrollTo("cabines")}
              className="btn-secondary text-lg"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              <ShoppingBag className="h-5 w-5" aria-hidden />
              Essayer le widget
            </motion.button>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-xs text-ink-muted">
            <TrustBadge color="bg-emerald-500" label="Shopify-ready" />
            <TrustBadge color="bg-gold" label="Sans compte client" />
            <TrustBadge color="bg-bordeaux" label="Photos non conservées" />
            <TrustBadge color="bg-fuchsia-500" label="IA configurable" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function TrustBadge({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 backdrop-blur-sm ring-1 ring-bordeaux/10">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
