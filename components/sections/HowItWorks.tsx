"use client";

import { motion } from "framer-motion";
import { MousePointerClick, Camera, Sparkles } from "lucide-react";

const STEPS = [
  {
    icon: MousePointerClick,
    title: "1. Le client clique sur « Essayer »",
    description:
      "La bulle IA apparaît directement sur la page produit Shopify. Aucun téléchargement, aucun compte.",
  },
  {
    icon: Camera,
    title: "2. Il importe une photo guidée",
    description:
      "Un guide animé étape par étape lui montre comment cadrer la zone à essayer (tête, poignet, buste…).",
  },
  {
    icon: Sparkles,
    title: "3. L'IA génère un aperçu avant achat",
    description:
      "Le client visualise le produit porté sur lui en moins d'une minute, puis revient sur le panier.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-bordeaux">
            Comment ça marche
          </p>
          <h2 className="font-display text-3xl font-bold sm:text-4xl">
            <span className="text-ink">Trois étapes pour vendre </span>
            <span className="text-gradient">avec confiance</span>
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className="glass-card relative overflow-hidden p-6"
              >
                <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-bordeaux/20 to-gold/20 blur-2xl" />
                <div className="relative">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-bordeaux to-gold text-white shadow-soft">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <h3 className="font-display text-xl font-semibold text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    {step.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
