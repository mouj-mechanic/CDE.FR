/**
 * Single source of truth for product identity. Updating these values
 * propagates to the Header, Footer, Hero, SEO metadata, embed widget
 * title and the privacy note — no other file should hardcode the brand.
 */

export const brand = {
  name: "TryWithAI",
  legacyName: "CabinesDEssayage.fr",
  tagline: "Try with AI before you buy.",
  taglineFr: "Essayez avec l'IA avant d'acheter.",
  positioning: "AI Try-On Widget for Shopify Stores",
  positioningFr: "Widget d'essayage virtuel IA pour boutiques Shopify",
  supportEmail: "contact@trywithai.app",
  defaultLocale: "fr",
  appDomain: "https://trywithai.app",
  // Used by the embed iframe + URL helpers in dev / preview environments.
  // When deployed, this should match `appDomain`.
  defaultEmbedOrigin: "https://trywithai.app",
} as const;

export type Brand = typeof brand;
