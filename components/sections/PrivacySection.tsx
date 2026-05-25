"use client";

import { motion } from "framer-motion";
import { Shield, Lock, ToggleRight, Gauge } from "lucide-react";

const POINTS = [
  {
    icon: Shield,
    title: "Usage limité aux aperçus",
    description:
      "Les photos client sont utilisées uniquement pour générer l'aperçu d'essayage demandé.",
  },
  {
    icon: Lock,
    title: "Pas de stockage permanent",
    description:
      "Dans ce MVP, aucune photo n'est conservée côté serveur après génération.",
  },
  {
    icon: ToggleRight,
    title: "Catégories contrôlées",
    description:
      "Le marchand active uniquement les catégories pertinentes pour sa boutique.",
  },
  {
    icon: Gauge,
    title: "Quotas IA configurables",
    description:
      "Chaque plan définit un nombre maximum d'essais IA. Aucun dépassement surprise.",
  },
];

export function PrivacySection() {
  return (
    <section className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-bordeaux">
            Confiance & confidentialité
          </p>
          <h2 className="font-display text-3xl font-bold sm:text-4xl">
            <span className="text-ink">Conçu pour respecter </span>
            <span className="text-gradient">vos clients</span>
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {POINTS.map((p, idx) => {
            const Icon = p.icon;
            return (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.07 }}
                className="flex gap-4 rounded-2xl border border-bordeaux/10 bg-white/70 p-5 backdrop-blur-md"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bordeaux/10 text-bordeaux">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <p className="font-semibold text-ink">{p.title}</p>
                  <p className="mt-1 text-sm text-ink-muted">{p.description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
