/**
 * Build platform-specific share URLs from a result url + share text.
 *
 * Kept as pure functions so we can unit-test them without touching
 * window / navigator. The interactive layer (Web Share API, copy to
 * clipboard, mailto) is handled by AssistantShareActions.
 */

import type { SharePlatform } from "@/types";

export interface ShareBundle {
  url: string;
  text: string;
  title: string;
}

export interface ShareLink {
  platform: SharePlatform;
  /** Click-through URL. For native / copy / instagram fallback this is `null`. */
  href: string | null;
  /** Whether navigator.share should be tried first. */
  preferNative?: boolean;
  /** Whether the link should be opened in a new tab. */
  newTab?: boolean;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function buildShareLink(
  platform: SharePlatform,
  bundle: ShareBundle
): ShareLink {
  const { url, text, title } = bundle;
  switch (platform) {
    case "whatsapp":
      return {
        platform,
        href: `https://wa.me/?text=${enc(text + " " + url)}`,
        newTab: true,
      };
    case "viber":
      return {
        platform,
        href: `viber://forward?text=${enc(text + " " + url)}`,
      };
    case "messenger":
      // FB Messenger requires an app id for `m.me`. We fall back to a
      // generic facebook share-quote dialog, which works without an
      // app id and degrades gracefully on desktop.
      return {
        platform,
        href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}`,
        newTab: true,
      };
    case "email":
      return {
        platform,
        href: `mailto:?subject=${enc(title)}&body=${enc(text + " " + url)}`,
      };
    case "instagram":
      // Instagram has no public web-share URL. We expose this as a
      // "prefer native, otherwise copy" intent — the caller will
      // call navigator.share() if available and fall back to copy.
      return {
        platform,
        href: null,
        preferNative: true,
      };
    case "native":
      return {
        platform,
        href: null,
        preferNative: true,
      };
    case "copy":
      return { platform, href: null };
    default:
      return { platform, href: null };
  }
}

/** Human-readable label for the share buttons. */
export function platformLabel(platform: SharePlatform): string {
  switch (platform) {
    case "whatsapp":
      return "WhatsApp";
    case "viber":
      return "Viber";
    case "messenger":
      return "Messenger";
    case "instagram":
      return "Instagram";
    case "email":
      return "Email";
    case "native":
      return "Partager…";
    case "copy":
      return "Copier le lien";
    default:
      return platform;
  }
}
