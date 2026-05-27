"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Minimize2,
  Maximize2,
  X,
  ShoppingBag,
  RefreshCw,
  Eye,
  Loader2,
} from "lucide-react";
import type { TryOnAssistantState } from "@/types";
import { AssistantShareActions } from "./AssistantShareActions";

export interface TryOnAssistantBubbleProps {
  state: TryOnAssistantState;
  onMinimize(): void;
  onRestore(): void;
  onOpenResult(): void;
  onTryAnother(): void;
  onAddToCart(): void;
  onClose?: () => void;
}

export function TryOnAssistantBubble({
  state,
  onMinimize,
  onRestore,
  onOpenResult,
  onTryAnother,
  onAddToCart,
  onClose,
}: TryOnAssistantBubbleProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the conversation as new messages arrive.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [state.messages.length, state.status]);

  const isWorking = useMemo(
    () =>
      state.status === "preparing" ||
      state.status === "analyzing_photo" ||
      state.status === "preparing_product" ||
      state.status === "placing_product" ||
      state.status === "generating" ||
      state.status === "quality_check",
    [state.status]
  );

  const isReady =
    state.status === "ready" || state.status === "fallback_ready";

  if (!state.active) return null;

  // ── Minimised pill ────────────────────────────────────────────────
  if (state.minimized) {
    return (
      <motion.button
        type="button"
        onClick={onRestore}
        initial={{ opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.95 }}
        className="fixed bottom-4 right-4 z-[2147483646] flex items-center gap-2 rounded-full bg-gradient-to-r from-bordeaux via-fuchsia-500 to-gold px-4 py-3 text-sm font-semibold text-white shadow-lifted ring-2 ring-white/40"
        aria-label={
          isReady
            ? "Votre essayage est prêt — ouvrir"
            : "Reprendre la simulation"
        }
        aria-live="polite"
      >
        {isWorking ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : isReady ? (
          <Sparkles className="h-4 w-4" aria-hidden />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden />
        )}
        <span className="max-w-[140px] truncate">
          {isReady
            ? "Votre essayage est prêt"
            : isWorking
              ? `Simulation… ${Math.round(state.progress)}%`
              : "Reprendre"}
        </span>
      </motion.button>
    );
  }

  // ── Expanded chat panel ───────────────────────────────────────────
  return (
    <motion.aside
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="fixed bottom-4 right-4 z-[2147483646] flex w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-bordeaux/15 bg-white shadow-lifted"
      role="region"
      aria-label="Assistant TryWithAI"
      aria-live="polite"
      aria-busy={isWorking}
    >
      <header className="flex items-center justify-between gap-2 bg-gradient-to-r from-bordeaux/10 via-fuchsia-100 to-gold/10 px-4 py-3">
        <div className="flex items-center gap-2 text-bordeaux">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight text-ink">
              Simulation IA
            </p>
            <p className="text-[11px] leading-tight text-ink-muted">
              {state.productTitle ?? "Votre essayage TryWithAI"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMinimize}
            className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-cream"
            aria-label="Réduire la bulle"
          >
            <Minimize2 className="h-4 w-4" aria-hidden />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-cream"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </header>

      {/* Progress bar */}
      {(isWorking || isReady) && (
        <div className="h-1 w-full bg-cream-dark">
          <motion.div
            className="h-full rounded-r bg-gradient-to-r from-bordeaux via-fuchsia-500 to-gold"
            initial={{ width: 0 }}
            animate={{ width: `${state.progress}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      )}

      {/* Conversation */}
      <div
        ref={scrollerRef}
        className="max-h-[280px] min-h-[140px] space-y-2 overflow-y-auto px-4 py-3 text-sm"
      >
        <AnimatePresence initial={false}>
          {state.messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 leading-snug ${
                  m.role === "user"
                    ? "bg-bordeaux text-white"
                    : m.kind === "opinion"
                      ? "bg-gold/10 text-ink"
                      : m.kind === "success"
                        ? "bg-emerald-50 text-emerald-900"
                        : m.kind === "warning"
                          ? "bg-amber-50 text-amber-900"
                          : m.kind === "error"
                            ? "bg-rose-50 text-rose-900"
                            : "bg-cream text-ink"
                }`}
              >
                {m.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Action row */}
      <div className="space-y-2 border-t border-cream-dark bg-cream-light/60 px-4 py-3">
        {isReady && state.resultUrl ? (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onOpenResult}
                className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-bordeaux via-fuchsia-500 to-gold px-3 py-2 text-sm font-semibold text-white shadow"
              >
                <Eye className="h-4 w-4" aria-hidden />
                Voir le résultat
              </button>
              {state.canAddToCart && (
                <button
                  type="button"
                  onClick={onAddToCart}
                  disabled={state.cartStatus === "adding"}
                  className="flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-ink ring-1 ring-bordeaux/15 transition-colors hover:bg-cream disabled:opacity-60"
                >
                  {state.cartStatus === "adding" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {state.cartStatus === "added"
                    ? "Ajouté ✓"
                    : "Ajouter au panier"}
                </button>
              )}
              <button
                type="button"
                onClick={onTryAnother}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-ink ring-1 ring-bordeaux/15 transition-colors hover:bg-cream"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Essayer un autre
              </button>
            </div>
            <AssistantShareActions
              resultUrl={state.shareUrl ?? state.resultUrl}
              shareTitle={state.productTitle}
            />
          </>
        ) : (
          <button
            type="button"
            onClick={onMinimize}
            className="w-full rounded-xl bg-white px-3 py-2 text-xs font-semibold text-bordeaux ring-1 ring-bordeaux/20 transition-colors hover:bg-cream"
          >
            <span className="inline-flex items-center gap-1.5">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
              Réduire et continuer les achats
            </span>
          </button>
        )}
      </div>
    </motion.aside>
  );
}
