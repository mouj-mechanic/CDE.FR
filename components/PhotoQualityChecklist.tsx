"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { analyzePhotoQuality, type QualityReport } from "@/lib/photoQuality";
import type { CategoryId } from "@/types";

interface Props {
  file: File | null;
  category: CategoryId;
  onReport?: (report: QualityReport | null) => void;
}

export function PhotoQualityChecklist({ file, category, onReport }: Props) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setReport(null);
      onReport?.(null);
      return;
    }
    setLoading(true);
    analyzePhotoQuality(file, category)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        onReport?.(r);
      })
      .catch(() => {
        if (cancelled) return;
        setReport(null);
        onReport?.(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, category, onReport]);

  if (!file) return null;

  return (
    <div className="rounded-2xl border border-bordeaux/15 bg-white/70 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">
          Qualité de votre photo
        </p>
        {loading && (
          <Loader2
            className="h-4 w-4 animate-spin text-bordeaux"
            aria-label="Analyse en cours"
          />
        )}
      </div>
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {report?.checks.map((check) => (
            <motion.li
              key={check.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-start gap-2 text-xs"
            >
              <span className="mt-0.5 shrink-0">
                {check.level === "ok" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                ) : check.level === "warning" ? (
                  <AlertTriangle
                    className="h-3.5 w-3.5 text-amber-600"
                    aria-hidden
                  />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={
                    check.level === "ok"
                      ? "font-medium text-ink"
                      : check.level === "warning"
                        ? "font-medium text-amber-900"
                        : "font-medium text-red-900"
                  }
                >
                  {check.label}
                </p>
                {check.hint && (
                  <p className="text-ink-muted">{check.hint}</p>
                )}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {report?.hasBlocker && (
        <p
          className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
          role="alert"
        >
          Corrigez les points rouges avant de lancer l&apos;essayage.
        </p>
      )}
    </div>
  );
}
