"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Minimize2,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { TryOnAssistantState, TryOnHistoryEntry } from "@/types";
import { HistoryCard } from "./HistoryCard";
import { SimulationPanel } from "./SimulationPanel";

export interface TryOnAssistantBubbleProps {
  state: TryOnAssistantState;
  onMinimize(): void;
  onRestore(): void;
  onTryAnother(): void;
  onClose?: () => void;
  /**
   * Rendered at the BOTTOM of the bubble feed when no job is in
   * flight and there's no fresh result for the current product —
   * i.e. the photo upload + consent + launch UI. Pass `null` to hide.
   */
  composeNode?: React.ReactNode;
  /** Per-card add-to-cart action. */
  onCardAddToCart(entry: TryOnHistoryEntry): void;
  /** Per-card "Agrandir" action — opens the in-iframe lightbox. */
  onCardAgrandir(entry: TryOnHistoryEntry): void;
}

/**
 * The single visible UI of the TryWithAI assistant. Renders a chat-
 * style scrollable feed of past try-on cards (newest at the bottom)
 * topped by either:
 *   - a SimulationPanel during loading (no double-bubble effect), OR
 *   - the compose form (photo upload) for the current product page.
 *
 * Latest entry is pinned at the bottom; scrolling up reveals older
 * try-ons with their own share / cart controls — exactly the kind of
 * persistent shopping-assistant UX the customer asked for.
 */
export function TryOnAssistantBubble({
  state,
  onMinimize,
  onRestore,
  onTryAnother,
  onClose,
  composeNode,
  onCardAddToCart,
  onCardAgrandir,
}: TryOnAssistantBubbleProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom (current state / latest card) as the
  // feed grows or the customer arrives.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    // Defer one frame so layouts settle before we measure.
    const id = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(id);
  }, [state.history.length, state.status, state.active]);

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
  const isError = state.status === "error";

  if (!state.active) return null;

  // Treat the LAST history entry as "current" only when its product
  // matches the current PDP context. Otherwise the entry stays in
  // the feed as a past try-on and the compose view shows below.
  const latestEntry = state.history.length
    ? state.history[state.history.length - 1]
    : null;
  const latestMatchesContext =
    latestEntry !== null &&
    (latestEntry.productUrl === state.productUrl ||
      latestEntry.productImage === state.productImage);
  const showComposeAtBottom =
    composeNode != null &&
    state.status === "idle" &&
    !isWorking &&
    !isReady &&
    !latestMatchesContext;

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
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden />
        )}
        <span className="max-w-[140px] truncate">
          {isReady
            ? "Votre essayage est prêt"
            : isWorking
              ? `Simulation… ${Math.round(state.progress)}%`
              : state.history.length > 0
                ? `${state.history.length} essai${state.history.length > 1 ? "s" : ""}`
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
      className="fixed bottom-4 right-4 z-[2147483646] flex max-h-[min(720px,90vh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-bordeaux/15 bg-white shadow-lifted"
      role="region"
      aria-label="Assistant TryWithAI"
      aria-live="polite"
      aria-busy={isWorking}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 bg-gradient-to-r from-bordeaux/10 via-fuchsia-100 to-gold/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-bordeaux">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-ink">
              TryWithAI
            </p>
            <p className="truncate text-[11px] leading-tight text-ink-muted">
              {isWorking
                ? `Simulation… ${Math.round(state.progress)}%`
                : isReady
                  ? "Votre essayage est prêt"
                  : state.productTitle ?? "Votre essayage virtuel"}
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

      {/* Progress bar (only while a job is in flight) */}
      {isWorking && (
        <div className="h-1 w-full shrink-0 bg-cream-dark">
          <motion.div
            className="h-full rounded-r bg-gradient-to-r from-bordeaux via-fuchsia-500 to-gold"
            initial={{ width: 0 }}
            animate={{ width: `${state.progress}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      )}

      {/* Scrollable feed: history cards + current state at the bottom. */}
      <div
        ref={scrollerRef}
        className="flex-1 space-y-3 overflow-y-auto bg-cream-light/50 px-3 py-3"
      >
        <AnimatePresence initial={false}>
          {state.history.map((entry, i) => {
            const isLatest = i === state.history.length - 1;
            return (
              <HistoryCard
                key={entry.id}
                entry={entry}
                isLatest={isLatest}
                onAddToCart={onCardAddToCart}
                onAgrandir={onCardAgrandir}
              />
            );
          })}
        </AnimatePresence>

        {/* Current job state — pinned at the bottom of the feed. */}
        {isWorking && (
          <motion.div
            key="sim-panel"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-bordeaux/10"
          >
            <SimulationPanel state={state} />
          </motion.div>
        )}

        {isError && (
          <motion.div
            key="error-panel"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-900 ring-1 ring-rose-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="leading-snug">
              Je n’ai pas pu finaliser ce rendu. Réessayez avec une photo
              plus nette, ou choisissez un autre modèle.
            </p>
          </motion.div>
        )}

        {showComposeAtBottom && (
          <motion.div
            key="compose"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-2xl bg-white p-3 shadow-soft ring-1 ring-bordeaux/10"
          >
            {composeNode}
          </motion.div>
        )}
      </div>

      {/* Footer: a single "Essayer un autre" CTA appears whenever
          the customer is already viewing a finished result. It does
          NOT show during a job (the simulation panel speaks for
          itself) or during compose (the launch button is in the
          compose form). */}
      {isReady && latestMatchesContext && (
        <div className="shrink-0 border-t border-cream-dark bg-white px-3 py-2">
          <button
            type="button"
            onClick={onTryAnother}
            className="w-full rounded-xl bg-white px-3 py-2 text-xs font-semibold text-bordeaux ring-1 ring-bordeaux/20 transition-colors hover:bg-cream"
          >
            Essayer un autre modèle
          </button>
        </div>
      )}
    </motion.aside>
  );
}
