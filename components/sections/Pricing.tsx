"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Plan {
  name: string;
  price: string;
  credits: string;
  features: string[];
  highlight?: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Starter",
    price: "49€",
    credits: "250 essais IA / mois",
    features: [
      "Widget Shopify intégré",
      "5 catégories supportées",
      "Mode démo (mock) inclus",
      "Support par email",
    ],
  },
  {
    name: "Growth",
    price: "149€",
    credits: "1 000 essais IA / mois",
    features: [
      "Tout Starter, plus :",
      "FLUX Kontext + FASHN",
      "Détection produit avancée",
      "Statistiques basiques",
    ],
    highlight: true,
  },
  {
    name: "Pro",
    price: "399€",
    credits: "3 000 essais IA / mois",
    features: [
      "Tout Growth, plus :",
      "Prompts personnalisés",
      "Webhook conversion",
      "Support prioritaire",
    ],
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-bordeaux">
            Tarifs
          </p>
          <h2 className="font-display text-3xl font-bold sm:text-4xl">
            <span className="text-ink">Un prix simple, </span>
            <span className="text-gradient">par essai IA généré</span>
          </h2>
          <p className="mt-3 text-ink-muted">
            Vous ne payez que pour ce qui est généré côté client.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan, idx) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              className={cn(
                "relative overflow-hidden rounded-3xl border p-6 shadow-soft",
                plan.highlight
                  ? "border-transparent bg-gradient-to-br from-bordeaux via-fuchsia-500 to-gold text-white shadow-lifted"
                  : "border-bordeaux/15 bg-white/80 backdrop-blur-md"
              )}
            >
              {plan.highlight && (
                <span className="absolute right-4 top-4 rounded-full bg-white/95 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bordeaux">
                  Populaire
                </span>
              )}
              <p
                className={cn(
                  "font-display text-2xl font-bold",
                  plan.highlight ? "text-white" : "text-ink"
                )}
              >
                {plan.name}
              </p>
              <div className="mt-3 flex items-baseline gap-1">
                <span
                  className={cn(
                    "font-display text-4xl font-bold",
                    plan.highlight ? "text-white" : "text-bordeaux"
                  )}
                >
                  {plan.price}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    plan.highlight ? "text-white/80" : "text-ink-muted"
                  )}
                >
                  /mois
                </span>
              </div>
              <p
                className={cn(
                  "mt-1 text-sm font-medium",
                  plan.highlight ? "text-white/90" : "text-ink-muted"
                )}
              >
                {plan.credits}
              </p>
              <ul
                className={cn(
                  "mt-6 space-y-2 text-sm",
                  plan.highlight ? "text-white/90" : "text-ink"
                )}
              >
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        plan.highlight ? "text-white" : "text-bordeaux"
                      )}
                      aria-hidden
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          Crédits supplémentaires disponibles selon usage. Prix indicatifs MVP.
        </p>
      </div>
    </section>
  );
}
