"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Share2,
  MessageCircle,
  Send,
  Mail,
  Camera,
  Link as LinkIcon,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { buildShareLink } from "@/lib/shareLinks";
import { postShare } from "@/lib/embedMessaging";
import type { SharePlatform } from "@/types";

interface AssistantShareActionsProps {
  resultUrl: string;
  shareText?: string;
  shareTitle?: string;
}

const DEFAULT_TEXT = "Découvrez mon essayage virtuel TryWithAI";
const DEFAULT_TITLE = "Mon essayage virtuel";

interface PlatformButton {
  id: SharePlatform;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}

const PLATFORMS: PlatformButton[] = [
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, className: "text-[#25D366]" },
  { id: "viber", label: "Viber", icon: MessageCircle, className: "text-[#7360F2]" },
  { id: "messenger", label: "Messenger", icon: Send, className: "text-[#0084FF]" },
  { id: "instagram", label: "Instagram / partager…", icon: Camera, className: "text-[#E1306C]" },
  { id: "email", label: "Email", icon: Mail, className: "text-bordeaux" },
];

export function AssistantShareActions({
  resultUrl,
  shareText = DEFAULT_TEXT,
  shareTitle = DEFAULT_TITLE,
}: AssistantShareActionsProps) {
  const [copied, setCopied] = useState(false);
  const [hasNative, setHasNative] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      setHasNative(true);
    }
  }, []);

  const bundle = useMemo(
    () => ({ url: resultUrl, text: shareText, title: shareTitle }),
    [resultUrl, shareText, shareTitle]
  );

  const tryNativeShare = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === "undefined" || !("share" in navigator)) {
      return false;
    }
    try {
      await (
        navigator as Navigator & {
          share: (data: ShareData) => Promise<void>;
        }
      ).share({
        title: bundle.title,
        text: bundle.text,
        url: bundle.url,
      });
      postShare({
        platform: "native",
        resultUrl: bundle.url,
        text: bundle.text,
        title: bundle.title,
      });
      return true;
    } catch {
      return false;
    }
  }, [bundle]);

  const copyLink = useCallback(async (announce = true) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(bundle.url);
        if (announce) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }
        return true;
      } catch {
        /* fall through */
      }
    }
    try {
      window.prompt("Copiez ce lien :", bundle.url);
      return true;
    } catch {
      return false;
    }
  }, [bundle.url]);

  const handle = useCallback(
    async (platform: SharePlatform) => {
      const link = buildShareLink(platform, bundle);

      // Instagram / native intents: prefer Web Share API, otherwise
      // fall back to copying the link (the customer pastes into the
      // app of their choice — IG, native share sheet, anything).
      if (link.preferNative) {
        const ok = await tryNativeShare();
        if (ok) return;
        await copyLink(true);
        return;
      }

      // Copy: explicit clipboard intent.
      if (platform === "copy") {
        await copyLink(true);
        return;
      }

      // URL-based platforms (WhatsApp, Viber, Messenger, Email).
      if (link.href) {
        postShare({
          platform,
          resultUrl: bundle.url,
          text: bundle.text,
          title: bundle.title,
        });
        if (link.newTab) {
          window.open(link.href, "_blank", "noopener,noreferrer");
        } else {
          window.location.href = link.href;
        }
      }
    },
    [bundle, tryNativeShare, copyLink]
  );

  return (
    <div className="space-y-1.5">
      {/* Toggle button — the only thing visible by default. Tapping
          it reveals the drawer with all platform options. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="trywithai-share-drawer"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-bordeaux/15 transition-colors hover:bg-cream"
      >
        <Share2 className="h-3.5 w-3.5 text-bordeaux" aria-hidden />
        Partager
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="trywithai-share-drawer"
            key="drawer"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {hasNative && (
                <button
                  type="button"
                  onClick={() => handle("native")}
                  className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-bordeaux/15 bg-bordeaux/5 px-3 py-2 text-xs font-semibold text-bordeaux transition-colors hover:bg-bordeaux/10"
                  aria-label="Partager via l’appareil"
                >
                  <Share2 className="h-4 w-4" aria-hidden />
                  Partager via l’appareil
                </button>
              )}
              {PLATFORMS.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handle(p.id)}
                    className="flex items-center gap-2 rounded-xl bg-cream-light px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-cream-dark"
                    aria-label={`Partager via ${p.label}`}
                  >
                    <Icon
                      className={`h-4 w-4 ${p.className ?? ""}`}
                      aria-hidden
                    />
                    <span className="truncate">{p.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => handle("copy")}
                className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-gold/10 px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-gold/15"
                aria-live="polite"
                aria-label="Copier le lien"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                    Lien copié
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-4 w-4 text-gold" aria-hidden />
                    Copier le lien
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
