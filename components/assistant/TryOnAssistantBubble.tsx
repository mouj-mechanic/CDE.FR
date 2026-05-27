"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Minimize2,
  Trash2,
  Loader2,
} from "lucide-react";
import type { TryOnAssistantState, TryOnHistoryEntry } from "@/types";
import { HistoryCard } from "./HistoryCard";

export interface TryOnAssistantBubbleProps {
  state: TryOnAssistantState;
  onMinimize(): void;
  onRestore(): void;
  onTryAnother(): void;
  onClose?: () => void;
  /**
   * Rendered at the BOTTOM of the bubble feed when no live (pending
   * or ready) entry exists for the current PDP. The photo upload +
   * consent + launch button live in here.
   */
  composeNode?: React.ReactNode;
  /** Per-card add-to-cart action. */
  onCardAddToCart(entry: TryOnHistoryEntry): void;
  /** Per-card "Agrandir" — opens the in-iframe lightbox. */
  onCardAgrandir(entry: TryOnHistoryEntry): void;
  /** Per-card retry for error / interrupted entries. */
  onCardRetry(entry: TryOnHistoryEntry): void;
}

/**
 * Single visible UI of the TryWithAI assistant. The bubble renders
 * one continuous flat surface (no nested coloured layers): a header
 * with two labeled actions (Réduire / Supprimer), then a scrollable
 * chat-style feed of try-on cards. Each card carries its own state
 * (live simulation, finished result, error / interrupted) so a job
 * started on PDP A keeps progressing in its card even after the
 * customer has navigated to PDP B.
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
  onCardRetry,
}: TryOnAssistantBubbleProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom (current state / latest card) as the
  // feed grows or the customer arrives.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const id = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(id);
  }, [
    state.history.length,
    state.status,
    state.active,
    state.progress,
  ]);

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

  const latestEntry = state.history.length
    ? state.history[state.history.length - 1]
    : null;
  const latestMatchesCurrentPDP =
    latestEntry !== null &&
    ((latestEntry.productUrl && latestEntry.productUrl === state.productUrl) ||
      (latestEntry.productImage &&
        latestEntry.productImage === state.productImage));
  const latestIsLiveForCurrentPDP =
    latestMatchesCurrentPDP &&
    latestEntry !== null &&
    (latestEntry.status === "pending" || latestEntry.status === "ready");
  const showComposeAtBottom =
    composeNode != null && !latestIsLiveForCurrentPDP;

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
        <span className="max-w-[160px] truncate">
          {isReady
            ? "Votre essayage est prêt"
            : isWorking
              ? `Simulation… ${Math.round(state.progress)}%`
              : state.history.length > 0
                ? `${state.history.length} essai${state.history.length > 1 ? "s" : ""} · reprendre`
                : "Reprendre"}
        </span>
      </motion.button>
    );
  }

  // ── Expanded chat panel — single flat surface ────────────────────
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
      {/* Header — flat, no gradient back layer. Just the brand mark
          and two clearly labeled actions. */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-cream-dark/60 bg-white px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-bordeaux/10 text-bordeaux">
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
                  : "Votre essayage virtuel"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onMinimize}
            className="inline-flex items-center gap-1 rounded-full bg-cream-light px-2.5 py-1 text-[11px] font-semibold text-ink ring-1 ring-bordeaux/10 transition-colors hover:bg-cream"
          >
            <Minimize2 className="h-3.5 w-3.5" aria-hidden />
            Réduire
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200 transition-colors hover:bg-rose-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Supprimer le chat
            </button>
          )}
        </div>
      </header>

      {/* Flat scrollable feed: cards + compose. No bg colour change
          between header and body — single visual layer. */}
      <div
        ref={scrollerRef}
        className="flex-1 space-y-3 overflow-y-auto bg-white px-3 py-3"
      >
        <AnimatePresence initial={false}>
          {state.history.map((entry, i) => {
            const isLatest = i === state.history.length - 1;
            // Only the entry whose jobId matches the running
            // simulator gets the live progress values.
            const isLive = entry.status === "pending" && entry.jobId === state.jobId;
            return (
              <HistoryCard
                key={entry.id}
                entry={entry}
                isLatest={isLatest}
                liveProgress={isLive ? state.progress : undefined}
                liveStage={isLive ? state.status : undefined}
                onAddToCart={onCardAddToCart}
                onAgrandir={onCardAgrandir}
                onRetry={onCardRetry}
              />
            );
          })}
        </AnimatePresence>

        {showComposeAtBottom && (
          <motion.div
            key="compose"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-2xl bg-white p-3 ring-1 ring-bordeaux/10"
          >
            {composeNode}
          </motion.div>
        )}
      </div>

      {/* Footer: a single "Essayer un autre" CTA appears whenever
          the customer's current PDP already has a finished result. */}
      {latestIsLiveForCurrentPDP && latestEntry?.status === "ready" && (
        <div className="shrink-0 border-t border-cream-dark/60 bg-white px-3 py-2">
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
