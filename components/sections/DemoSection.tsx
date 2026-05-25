"use client";

import { motion } from "framer-motion";
import { ExternalLink, KeyRound, Store } from "lucide-react";

const SHOPIFY_DEMO_URL = "https://try-with-ai-demo.myshopify.com/collections/all";
const SHOPIFY_DEMO_PASSWORD = "1234";

export function DemoSection() {
  return (
    <section id="demo" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-bordeaux">
            Démo
          </p>
          <h2 className="font-display text-3xl font-bold sm:text-4xl">
            <span className="text-ink">Voyez le widget </span>
            <span className="text-gradient">en situation réelle</span>
          </h2>
          <p className="mt-3 text-ink-muted">
            Une vraie boutique Shopify avec{" "}
            <span className="font-semibold text-bordeaux">TryWithAI</span>{" "}
            installé. Ouvrez une fiche produit et attendez 1-2 secondes pour
            voir la bulle d&apos;essayage apparaître.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
        >
          <a
            href={SHOPIFY_DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group glass-card flex flex-col gap-4 p-6 transition-all hover:-translate-y-1 hover:shadow-lifted sm:flex-row sm:items-center sm:gap-6"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-bordeaux to-gold text-white shadow-soft">
              <Store className="h-6 w-6" aria-hidden />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
                  Shopify
                </span>
                <p className="font-display text-lg font-semibold text-ink">
                  Try with AI — Shopify demo shop
                </p>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Boutique fictive Shopify avec le module TryWithAI intégré.
                Détection automatique du produit, essayage IA sur les fiches.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-bordeaux/5 px-3 py-1.5 text-xs text-ink">
                <KeyRound className="h-3.5 w-3.5 text-bordeaux" aria-hidden />
                <span>
                  Mot de passe :{" "}
                  <span className="font-mono font-semibold text-bordeaux">
                    {SHOPIFY_DEMO_PASSWORD}
                  </span>
                </span>
              </div>
            </div>

            <ExternalLink
              className="hidden h-5 w-5 shrink-0 text-bordeaux transition-transform group-hover:translate-x-1 sm:block"
              aria-hidden
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
