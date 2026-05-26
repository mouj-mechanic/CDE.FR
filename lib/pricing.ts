import { brand } from "./brand";

/**
 * Single source of truth for the TryWithAI pricing surface.
 *
 *  Why centralised?
 *    - Pricing copy ends up in many places (landing, demo CTA, emails,
 *      embed badges, future docs). Hardcoding leads to drift the moment
 *      one number moves.
 *    - This file is imported by `components/sections/Pricing.tsx`. Any
 *      future surface (CLI, internal admin, dashboards) should consume
 *      it too.
 *
 *  Pricing model:
 *    - Each paid plan ships with a fixed monthly try-on credit allowance.
 *    - Generations beyond that cap are billed à la carte at the plan's
 *      `extraTryOnPrice`. There is *no* unlimited tier on purpose — real
 *      AI generation costs ~€0.15/run and we want the cost predictable.
 *    - Unused credits do not roll over.
 */

export type PlanId = "starter" | "growth" | "pro" | "enterprise";

export interface PricingPlan {
  id: PlanId;
  name: string;
  /** "€49" / "Custom" — kept as display string. */
  price: string;
  /** "/month" / "" — appended after price. */
  period: string;
  /** Human-readable allowance ("100", "Custom volume"). */
  includedTryOnsLabel: string;
  /** Numeric allowance (null for Enterprise). Useful for analytics. */
  includedTryOns: number | null;
  /** Display string for the per-extra-try-on price. */
  extraTryOnPrice: string;
  /** One-line audience summary (FR, the app's primary language). */
  bestFor: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  highlight?: boolean;
  /** Subtle "Le plus populaire" badge on the card. */
  popular?: boolean;
}

const demoMailto = `mailto:${brand.supportEmail}?subject=TryWithAI%20Demo`;
const enterpriseMailto = `mailto:${brand.supportEmail}?subject=TryWithAI%20Enterprise`;
const earlyAccessMailto = `mailto:${brand.supportEmail}?subject=TryWithAI%20Early%20Access`;

export const pricingPlans: PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: "€49",
    period: "/mois",
    includedTryOnsLabel: "100",
    includedTryOns: 100,
    extraTryOnPrice: "€0,49",
    bestFor:
      "Pour les petites boutiques Shopify qui découvrent l'essayage IA.",
    features: [
      "100 essayages IA / mois",
      "Widget intégré à la page produit Shopify",
      "Activation produit par produit",
      "Branding de base",
      "Limites d'usage configurables",
      "Support par email",
    ],
    ctaLabel: "Commencer avec une démo",
    ctaHref: "#demo",
  },
  {
    id: "growth",
    name: "Growth",
    price: "€149",
    period: "/mois",
    includedTryOnsLabel: "400",
    includedTryOns: 400,
    extraTryOnPrice: "€0,39",
    bestFor:
      "Pour les marques en croissance qui veulent augmenter l'engagement produit.",
    features: [
      "400 essayages IA / mois",
      "Tout ce qu'inclut Starter",
      "Configuration multi-catégories",
      "Branding avancé",
      "Statistiques d'usage",
      "Support prioritaire",
    ],
    ctaLabel: "Réserver une démo",
    ctaHref: demoMailto,
    highlight: true,
    popular: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "€399",
    period: "/mois",
    includedTryOnsLabel: "1 200",
    includedTryOns: 1200,
    extraTryOnPrice: "€0,29",
    bestFor:
      "Pour les boutiques à fort trafic et les marques sérieuses.",
    features: [
      "1 200 essayages IA / mois",
      "Tout ce qu'inclut Growth",
      "Limites mensuelles plus élevées",
      "Catégories et règles produit personnalisées",
      "Onboarding premium",
      "Traitement prioritaire des incidents",
    ],
    ctaLabel: "Réserver une démo",
    ctaHref: demoMailto,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Sur mesure",
    period: "",
    includedTryOnsLabel: "Volume sur mesure",
    includedTryOns: null,
    extraTryOnPrice: "Tarifs au volume",
    bestFor:
      "Pour les volumes élevés, agences et intégrations personnalisées.",
    features: [
      "Volume d'essayages IA sur mesure",
      "Intégrations personnalisées",
      "Support agence / multi-boutiques",
      "Onboarding dédié",
      "SLA discutable",
      "Tarifs au volume",
    ],
    ctaLabel: "Nous contacter",
    ctaHref: enterpriseMailto,
  },
];

export interface EarlyAccessOffer {
  title: string;
  badge: string;
  price: string;
  priceDescription: string;
  pitch: string;
  bullets: string[];
  afterPilot: string;
  ctaLabel: string;
  ctaHref: string;
}

export const earlyAccessOffer: EarlyAccessOffer = {
  title: "Pack pilote Early Access",
  badge: "Early Access",
  price: "€499",
  priceDescription: "setup",
  pitch:
    "Lancez TryWithAI sur votre boutique Shopify avec une mise en place guidée et un usage IA contrôlé.",
  bullets: [
    "Installation Shopify incluse",
    "2 mois inclus",
    "100 essayages IA par mois",
    "Configuration du widget sur une sélection de produits",
    "Feedback prioritaire et accompagnement",
  ],
  afterPilot: "Après le pilote : à partir de €49/mois.",
  ctaLabel: "Postuler à l'Early Access",
  ctaHref: earlyAccessMailto,
};

export interface CostControlCard {
  title: string;
  description: string;
}

export const costControlCards: CostControlCard[] = [
  {
    title: "Plafonds mensuels par crédit",
    description:
      "Chaque boutique dispose d'un nombre fixe d'essayages IA par mois.",
  },
  {
    title: "Tarif au dépassement",
    description:
      "Les générations supplémentaires ne sont facturées qu'en cas de dépassement.",
  },
  {
    title: "Activation au niveau produit",
    description:
      "Activez TryWithAI uniquement sur les produits ou catégories choisis.",
  },
  {
    title: "Pas d'exposition illimitée",
    description:
      "Vos coûts IA restent prévisibles à mesure que votre boutique grandit.",
  },
];

export const pricingCopy = {
  eyebrow: "Tarifs",
  titleLead: "Crédits mensuels d'essayage IA",
  titleAccent: "des coûts maîtrisés",
  subtitle:
    "Chaque plan inclut des crédits mensuels d'essayage IA. Les essais supplémentaires sont facturés uniquement en cas de dépassement.",
  trust:
    "Pas de coût IA illimité. Vous contrôlez les produits éligibles et le nombre d'essayages mensuels que votre boutique peut générer.",
  notes: [
    "1 essayage IA = 1 aperçu généré.",
    "Les essayages mensuels non utilisés ne sont pas reportés.",
    "La tarification peut être adaptée pour les boutiques à fort volume.",
  ],
  costControlEyebrow: "Usage maîtrisé",
  costControlTitle: "Conçu pour un usage IA contrôlé",
  earlyAccessEyebrow: "Onboarding limité",
};
