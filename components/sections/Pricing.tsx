"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  costControlCards,
  earlyAccessOffer,
  pricingCopy,
  pricingPlans,
  type PricingPlan,
} from "@/lib/pricing";

export function Pricing() {
  return (
    <section
      id="pricing"
      className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-6xl">
        <Header />

        <TrustBanner />

        <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {pricingPlans.map((plan, idx) => (
            <PlanCard key={plan.id} plan={plan} index={idx} />
          ))}
        </div>

        <Notes />

        <CostControl />

        <EarlyAccess />
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Header
// ──────────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div className="mb-8 text-center">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-bordeaux">
        {pricingCopy.eyebrow}
      </p>
      <h2 className="font-display text-3xl font-bold sm:text-4xl">
        <span className="text-ink">{pricingCopy.titleLead}, </span>
        <span className="text-gradient">{pricingCopy.titleAccent}</span>
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-ink-muted">
        {pricingCopy.subtitle}
      </p>
    </div>
  );
}

function TrustBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className="mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-bordeaux/15 bg-white/70 p-4 text-sm text-ink shadow-soft backdrop-blur-md"
    >
      <Sparkles
        className="mt-0.5 h-4 w-4 shrink-0 text-bordeaux"
        aria-hidden
      />
      <p>{pricingCopy.trust}</p>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Plan card
// ──────────────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: PricingPlan;
  index: number;
}

function PlanCard({ plan, index }: PlanCardProps) {
  const isHighlight = Boolean(plan.highlight);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.07 }}
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-3xl border p-6 shadow-soft transition",
        isHighlight
          ? "border-transparent bg-gradient-to-br from-bordeaux via-fuchsia-500 to-gold text-white shadow-lifted"
          : "border-bordeaux/15 bg-white/85 text-ink backdrop-blur-md hover:border-bordeaux/30 hover:shadow-lifted"
      )}
    >
      {plan.popular && (
        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bordeaux shadow-sm">
          <Star className="h-3 w-3" aria-hidden />
          Le plus populaire
        </span>
      )}

      {/* Plan name */}
      <p
        className={cn(
          "font-display text-2xl font-bold",
          isHighlight ? "text-white" : "text-ink"
        )}
      >
        {plan.name}
      </p>

      {/* Price */}
      <div className="mt-3 flex items-baseline gap-1">
        <span
          className={cn(
            "font-display text-4xl font-bold leading-none",
            isHighlight ? "text-white" : "text-bordeaux"
          )}
        >
          {plan.price}
        </span>
        {plan.period && (
          <span
            className={cn(
              "text-sm",
              isHighlight ? "text-white/85" : "text-ink-muted"
            )}
          >
            {plan.period}
          </span>
        )}
      </div>

      {/* Included AI try-ons — emphasized */}
      <div
        className={cn(
          "mt-4 rounded-xl border px-3 py-2.5",
          isHighlight
            ? "border-white/30 bg-white/10"
            : "border-bordeaux/15 bg-bordeaux/5"
        )}
      >
        <p
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wider",
            isHighlight ? "text-white/80" : "text-ink-muted"
          )}
        >
          Essayages IA inclus
        </p>
        <p
          className={cn(
            "mt-0.5 font-display text-xl font-bold",
            isHighlight ? "text-white" : "text-ink"
          )}
        >
          {plan.includedTryOnsLabel}
          {plan.includedTryOns !== null && (
            <span
              className={cn(
                "ml-1 text-sm font-normal",
                isHighlight ? "text-white/85" : "text-ink-muted"
              )}
            >
              / mois
            </span>
          )}
        </p>
      </div>

      {/* Best for */}
      <p
        className={cn(
          "mt-4 text-sm leading-relaxed",
          isHighlight ? "text-white/90" : "text-ink-muted"
        )}
      >
        {plan.bestFor}
      </p>

      {/* Features */}
      <ul
        className={cn(
          "mt-5 space-y-2 text-sm",
          isHighlight ? "text-white/95" : "text-ink"
        )}
      >
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                isHighlight ? "text-white" : "text-bordeaux"
              )}
              aria-hidden
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* Extra try-on price — visually distinct */}
      <div
        className={cn(
          "mt-5 flex items-baseline justify-between rounded-xl border-t-2 border-dashed pt-3 text-xs",
          isHighlight
            ? "border-white/30 text-white/85"
            : "border-bordeaux/20 text-ink-muted"
        )}
      >
        <span>Essayage supplémentaire</span>
        <span
          className={cn(
            "font-semibold",
            isHighlight ? "text-white" : "text-bordeaux"
          )}
        >
          {plan.extraTryOnPrice}
        </span>
      </div>

      {/* CTA */}
      <a
        href={plan.ctaHref}
        className={cn(
          "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition",
          isHighlight
            ? "bg-white text-bordeaux hover:bg-white/90"
            : "bg-bordeaux text-white hover:bg-bordeaux/90"
        )}
      >
        {plan.ctaLabel}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </a>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Notes (small print under plans)
// ──────────────────────────────────────────────────────────────────────────

function Notes() {
  return (
    <ul className="mt-6 grid gap-2 text-center text-xs text-ink-muted sm:grid-cols-3">
      {pricingCopy.notes.map((note) => (
        <li key={note} className="rounded-lg bg-white/40 px-3 py-2">
          {note}
        </li>
      ))}
    </ul>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Cost control cards
// ──────────────────────────────────────────────────────────────────────────

function CostControl() {
  return (
    <div className="mt-20">
      <div className="mb-8 text-center">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-bordeaux">
          {pricingCopy.costControlEyebrow}
        </p>
        <h3 className="font-display text-2xl font-bold text-ink sm:text-3xl">
          {pricingCopy.costControlTitle}
        </h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {costControlCards.map((card, idx) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: idx * 0.06 }}
            className="rounded-2xl border border-bordeaux/10 bg-white/70 p-5 backdrop-blur-md"
          >
            <p className="font-semibold text-ink">{card.title}</p>
            <p className="mt-1.5 text-sm text-ink-muted">{card.description}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Early Access pilot offer
// ──────────────────────────────────────────────────────────────────────────

function EarlyAccess() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="mt-20"
    >
      <div className="relative overflow-hidden rounded-3xl border-2 border-gold/40 bg-gradient-to-br from-bordeaux/95 via-fuchsia-700/90 to-gold/90 p-1 shadow-lifted">
        <div className="rounded-[22px] bg-ink/95 p-8 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            {/* Left — pitch */}
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gold">
                <Sparkles className="h-3 w-3" aria-hidden />
                {earlyAccessOffer.badge}
              </span>
              <h3 className="mt-4 font-display text-2xl font-bold text-white sm:text-3xl">
                {earlyAccessOffer.title}
              </h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/80">
                {earlyAccessOffer.pitch}
              </p>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold text-white">
                  {earlyAccessOffer.price}
                </span>
                <span className="text-sm text-white/70">
                  {earlyAccessOffer.priceDescription}
                </span>
              </div>
              <p className="mt-2 text-xs text-white/65">
                {earlyAccessOffer.afterPilot}
              </p>
              <a
                href={earlyAccessOffer.ctaHref}
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-gold px-5 py-3 text-sm font-semibold text-ink transition hover:bg-gold/90"
              >
                {earlyAccessOffer.ctaLabel}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>

            {/* Right — bullets */}
            <ul className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-white/90 backdrop-blur-md">
              {earlyAccessOffer.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-gold"
                    aria-hidden
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
