"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Share2,
  Link as LinkIcon,
  Check,
  Mail,
  MessageCircle,
  Twitter,
  Facebook,
  Linkedin,
  Send,
  Smartphone,
} from "lucide-react";

interface ShareMenuProps {
  resultUrl: string;
  shareText?: string;
  shareTitle?: string;
}

const DEFAULT_TEXT = "Découvrez mon essayage virtuel sur CabinesDEssayage.fr";
const DEFAULT_TITLE = "Mon essayage virtuel";

export function ShareMenu({
  resultUrl,
  shareText = DEFAULT_TEXT,
  shareTitle = DEFAULT_TITLE,
}: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasNativeShare, setHasNativeShare] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      setHasNativeShare(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const publicUrl =
    /^https?:\/\//.test(resultUrl) && !resultUrl.includes("localhost")
      ? resultUrl
      : typeof window !== "undefined"
        ? window.location.origin
        : "https://cabinesdessayage.fr";

  const encUrl = encodeURIComponent(publicUrl);
  const encText = encodeURIComponent(shareText);
  const encTitle = encodeURIComponent(shareTitle);

  const handleNativeShare = useCallback(async () => {
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: publicUrl,
      });
      setOpen(false);
    } catch {
      // user cancelled, no-op
    }
  }, [shareTitle, shareText, publicUrl]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copiez ce lien :", publicUrl);
    }
  }, [publicUrl]);

  const openShare = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=600");
    setOpen(false);
  };

  const platforms: {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    onClick: () => void;
  }[] = [
    {
      id: "whatsapp",
      label: "WhatsApp",
      icon: MessageCircle,
      color: "text-[#25D366]",
      onClick: () => openShare(`https://wa.me/?text=${encText}%20${encUrl}`),
    },
    {
      id: "twitter",
      label: "X / Twitter",
      icon: Twitter,
      color: "text-ink",
      onClick: () =>
        openShare(
          `https://twitter.com/intent/tweet?text=${encText}&url=${encUrl}`
        ),
    },
    {
      id: "facebook",
      label: "Facebook",
      icon: Facebook,
      color: "text-[#1877F2]",
      onClick: () =>
        openShare(
          `https://www.facebook.com/sharer/sharer.php?u=${encUrl}&quote=${encText}`
        ),
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      icon: Linkedin,
      color: "text-[#0A66C2]",
      onClick: () =>
        openShare(
          `https://www.linkedin.com/sharing/share-offsite/?url=${encUrl}`
        ),
    },
    {
      id: "telegram",
      label: "Telegram",
      icon: Send,
      color: "text-[#229ED9]",
      onClick: () =>
        openShare(`https://t.me/share/url?url=${encUrl}&text=${encText}`),
    },
    {
      id: "pinterest",
      label: "Pinterest",
      icon: PinterestIcon,
      color: "text-[#E60023]",
      onClick: () =>
        openShare(
          `https://pinterest.com/pin/create/button/?url=${encUrl}&media=${encodeURIComponent(
            resultUrl
          )}&description=${encText}`
        ),
    },
    {
      id: "email",
      label: "Email",
      icon: Mail,
      color: "text-bordeaux",
      onClick: () => {
        window.location.href = `mailto:?subject=${encTitle}&body=${encText}%20${encUrl}`;
        setOpen(false);
      },
    },
  ];

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 className="h-5 w-5" aria-hidden />
        Partager
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute left-1/2 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-ink/10 bg-white p-2 text-left shadow-lifted backdrop-blur-sm"
          >
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Partager le résultat
            </p>

            {hasNativeShare && (
              <button
                type="button"
                role="menuitem"
                onClick={handleNativeShare}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-cream"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-bordeaux/10 text-bordeaux">
                  <Smartphone className="h-4 w-4" aria-hidden />
                </span>
                <span className="font-medium text-ink">
                  Partager via l&apos;appareil
                </span>
              </button>
            )}

            <div className="grid grid-cols-1 gap-0.5">
              {platforms.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    onClick={p.onClick}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-cream"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cream-dark/60">
                      <Icon className={`h-4 w-4 ${p.color}`} />
                    </span>
                    <span className="font-medium text-ink">{p.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="my-1 h-px bg-ink/10" />

            <button
              type="button"
              role="menuitem"
              onClick={handleCopy}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-cream"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-gold">
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  <LinkIcon className="h-4 w-4" aria-hidden />
                )}
              </span>
              <span className="font-medium text-ink">
                {copied ? "Lien copié" : "Copier le lien"}
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PinterestIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345-.09.375-.293 1.199-.334 1.366-.053.222-.174.269-.402.162-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
    </svg>
  );
}
