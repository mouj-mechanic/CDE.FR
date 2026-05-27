"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download as DownloadIcon } from "lucide-react";
import { postLightboxClose, postLightboxOpen } from "@/lib/embedMessaging";

interface AssistantLightboxProps {
  imageUrl: string | null;
  productTitle?: string;
  onClose(): void;
}

/**
 * Full-screen overlay for the "Agrandir" action — renders INSIDE the
 * embed iframe (not as a popup window) so it works reliably across
 * Shopify themes and ignores popup blockers. Click anywhere outside
 * the image OR press Esc to close.
 */
export function AssistantLightbox({
  imageUrl,
  productTitle,
  onClose,
}: AssistantLightboxProps) {
  useEffect(() => {
    if (!imageUrl) return;
    // Ask the host to grow the iframe to fullscreen so the overlay
    // actually covers the merchant page (the bubble iframe is only
    // ~440px wide otherwise — the customer would barely see the
    // "Agrandir" effect).
    postLightboxOpen();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      postLightboxClose();
    };
  }, [imageUrl, onClose]);

  return (
    <AnimatePresence>
      {imageUrl && (
        <motion.div
          key="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu du résultat"
        >
          <motion.img
            key={imageUrl}
            src={imageUrl}
            alt={
              productTitle
                ? `Essayage de ${productTitle}`
                : "Aperçu agrandi de votre essayage"
            }
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
          />

          {/* Top-right close */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Fermer"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-ink shadow-lifted transition-transform hover:scale-105"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>

          {/* Bottom action: open in new tab as a true full-resolution
              "download". Kept lightweight — primary action is the
              big in-iframe view above. */}
          <a
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-ink shadow-lifted transition-transform hover:scale-105"
          >
            <DownloadIcon className="h-3.5 w-3.5" aria-hidden />
            Ouvrir l’image en grand
          </a>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
