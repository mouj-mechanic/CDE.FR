"use client";

import { motion } from "framer-motion";
import { Calendar } from "lucide-react";
import { brand } from "@/lib/brand";

export function FinalCTA() {
  return (
    <section id="contact" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="relative mx-auto max-w-4xl overflow-hidden rounded-4xl bg-gradient-to-br from-bordeaux via-fuchsia-500 to-gold p-10 text-center text-white shadow-lifted sm:p-14"
      >
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.4),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.3),transparent_50%)]" />
        <div className="relative">
          <h2 className="font-display text-3xl font-bold leading-tight sm:text-4xl">
            Prêt à ajouter l&apos;essayage IA à votre boutique Shopify ?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-white/90">
            On vous accompagne pour intégrer {brand.name} sur votre PDP en
            moins de 30 minutes.
          </p>
          <a
            href={`mailto:${brand.supportEmail}?subject=Démo TryWithAI`}
            className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-4 font-semibold text-bordeaux shadow-lifted transition hover:scale-[1.03]"
          >
            <Calendar className="h-5 w-5" aria-hidden />
            Réserver une démo
          </a>
        </div>
      </motion.div>
    </section>
  );
}
