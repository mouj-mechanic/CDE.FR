"use client";

import { useCallback } from "react";
import Image from "next/image";
import { Download, RefreshCw, ShoppingBag, RotateCcw } from "lucide-react";
import { PrivacyNote } from "./PrivacyNote";

interface ResultViewProps {
  resultUrl: string;
  onDownload: () => void;
  onRetry: () => void;
  onChangeProduct: () => void;
  onClose: () => void;
}

export function ResultView({
  resultUrl,
  onDownload,
  onRetry,
  onChangeProduct,
  onClose,
}: ResultViewProps) {
  const handleDownload = useCallback(async () => {
    const isExternal = /^https?:\/\//.test(resultUrl);
    const downloadHref = isExternal
      ? `/api/download?url=${encodeURIComponent(resultUrl)}`
      : resultUrl;
    const ext = (() => {
      const m = resultUrl.match(/\.(jpe?g|png|webp|svg)(\?|$)/i);
      return m ? m[1].toLowerCase() : "png";
    })();
    try {
      const response = await fetch(downloadHref);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `essayage-cabines-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onDownload();
    } catch {
      window.open(resultUrl, "_blank");
    }
  }, [resultUrl, onDownload]);

  const isSvg = resultUrl.endsWith(".svg");

  return (
    <div className="space-y-6 text-center">
      <h3 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
        Votre essayage est prêt
      </h3>

      <div className="relative mx-auto max-w-lg overflow-hidden rounded-2xl border border-ink/10 bg-cream-dark shadow-lifted">
        {isSvg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resultUrl}
            alt="Résultat de votre essayage virtuel"
            className="w-full object-contain"
          />
        ) : (
          <Image
            src={resultUrl}
            alt="Résultat de votre essayage virtuel"
            width={600}
            height={800}
            className="w-full object-contain"
            unoptimized
          />
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        <button type="button" onClick={handleDownload} className="btn-primary">
          <Download className="h-5 w-5" aria-hidden />
          Télécharger l&apos;image
        </button>
        <button type="button" onClick={onRetry} className="btn-secondary">
          <RefreshCw className="h-5 w-5" aria-hidden />
          Réessayer
        </button>
        <button type="button" onClick={onChangeProduct} className="btn-secondary">
          <ShoppingBag className="h-5 w-5" aria-hidden />
          Changer d&apos;article
        </button>
        <button type="button" onClick={onClose} className="btn-ghost">
          <RotateCcw className="h-5 w-5" aria-hidden />
          Nouvelle catégorie
        </button>
      </div>

      <PrivacyNote />
    </div>
  );
}
