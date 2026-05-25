"use client";

import { motion } from "framer-motion";
import { Code2, ShoppingBag, ScanSearch, Package } from "lucide-react";
import { brand } from "@/lib/brand";

const FEATURES = [
  {
    icon: Code2,
    title: "Widget embarquable",
    description:
      "Une seule balise <script> à coller dans theme.liquid. Aucune installation OAuth complexe pour démarrer.",
  },
  {
    icon: ScanSearch,
    title: "Détection automatique du produit",
    description:
      "Le widget lit ShopifyAnalytics, og:image, JSON-LD et la galerie pour récupérer le titre et l'image.",
  },
  {
    icon: Package,
    title: "Pré-remplissage produit",
    description:
      "Le client n'a rien à ajouter manuellement : l'article est déjà chargé dans la cabine.",
  },
  {
    icon: ShoppingBag,
    title: "Compatible tous thèmes",
    description:
      "Dawn, Studio, Sense, custom… Le script s'adapte au DOM Shopify sans toucher au thème.",
  },
];

const SNIPPET = `<script
  src="${brand.appDomain}/embed.js"
  data-app-url="${brand.appDomain}"
  data-label="Essayer avec l'IA"
  data-delay="1500"
  data-color="#7C3AED"
  async></script>`;

export function ShopifyIntegration() {
  return (
    <section id="shopify" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-bordeaux">
            Intégration Shopify
          </p>
          <h2 className="font-display text-3xl font-bold sm:text-4xl">
            <span className="text-ink">Une balise </span>
            <span className="text-gradient">&lt;script&gt;</span>
            <span className="text-ink"> et c&apos;est en ligne.</span>
          </h2>
          <p className="mt-4 text-ink-muted">
            Le widget se charge en asynchrone uniquement sur les pages produit
            (PDP). Il ne ralentit pas le reste de votre boutique et reste
            invisible côté mobile tant qu&apos;il n&apos;est pas appelé.
          </p>

          <div className="mt-6 space-y-3">
            {FEATURES.map((f, idx) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: idx * 0.08 }}
                  className="flex gap-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bordeaux/10 text-bordeaux">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div>
                    <p className="font-semibold text-ink">{f.title}</p>
                    <p className="text-sm text-ink-muted">{f.description}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="overflow-hidden rounded-3xl border border-bordeaux/20 bg-gradient-to-br from-ink to-bordeaux-dark p-1 shadow-lifted"
        >
          <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-white/60">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
            <span className="ml-2 font-mono">theme.liquid</span>
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-ink/95 p-5 font-mono text-xs leading-relaxed text-emerald-200 sm:text-sm">
            <code>{SNIPPET}</code>
          </pre>
        </motion.div>
      </div>
    </section>
  );
}
