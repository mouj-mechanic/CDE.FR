"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  Eye,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import type { TryOnAssistantState, TryOnHistoryEntry } from "@/types";
import { mapTryOnStageToMessage } from "@/lib/assistantProgress";
import { AssistantShareActions } from "./AssistantShareActions";

interface HistoryCardProps {
  entry: TryOnHistoryEntry;
  /** Indicates this is the most recent entry — gets a subtle accent. */
  isLatest?: boolean;
  /** Live progress / stage for an entry whose simulator is still running. */
  liveProgress?: number;
  liveStage?: TryOnAssistantState["status"];
  onAddToCart(entry: TryOnHistoryEntry): void;
  onAgrandir(entry: TryOnHistoryEntry): void;
  onRetry?(entry: TryOnHistoryEntry): void;
}

/**
 * A self-contained card for one try-on attempt. Renders the right
 * inner UI depending on the entry's lifecycle status:
 *
 *  - pending     → live simulation panel (no double bubble effect)
 *  - ready       → result image + opinion + cart / share / agrandir
 *  - error       → friendly error with a retry button
 *  - interrupted → "interrupted" placeholder with a retry button
 */
export function HistoryCard({
  entry,
  isLatest,
  liveProgress,
  liveStage,
  onAddToCart,
  onAgrandir,
  onRetry,
}: HistoryCardProps) {
  const isPending = entry.status === "pending";
  const isReady = entry.status === "ready";
  const isError = entry.status === "error";
  const isInterrupted = entry.status === "interrupted";

  const cartAdding = entry.cartStatus === "adding";
  const cartAdded = entry.cartStatus === "added";

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`overflow-hidden rounded-2xl border bg-white ${
        isLatest
          ? "border-bordeaux/30 shadow-soft"
          : "border-ink/10"
      }`}
    >
      {/* Compact product row */}
      <div className="flex items-center gap-2 border-b border-cream-dark/60 px-3 py-2">
        {entry.productImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.productImage}
            alt=""
            className="h-8 w-8 rounded-md bg-cream-dark object-cover ring-1 ring-ink/10"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-bordeaux/10 text-bordeaux">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-ink">
            {entry.productTitle ?? "Article essayé"}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-ink-muted">
            {labelForCategory(entry.category)}
            {isLatest && isReady && " · dernier essai"}
            {isPending && " · simulation en cours"}
            {isInterrupted && " · interrompue"}
            {isError && " · échec"}
          </p>
        </div>
      </div>

      {/* Body — content depends on the entry's lifecycle status. */}
      {isPending && (
        <PendingBody entry={entry} liveProgress={liveProgress} liveStage={liveStage} />
      )}

      {isReady && entry.resultUrl && (
        <>
          <button
            type="button"
            onClick={() => onAgrandir(entry)}
            className="block w-full overflow-hidden bg-cream-dark"
            aria-label="Agrandir le résultat"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.resultUrl}
              alt={`Essayage ${entry.productTitle ?? ""}`}
              className="block max-h-[220px] w-full object-contain"
            />
          </button>

          {entry.opinion && (
            <div className="bg-gold/10 px-3 py-2 text-xs leading-snug text-ink">
              {entry.opinion}
            </div>
          )}

          <div className="space-y-1.5 px-3 py-2">
            <button
              type="button"
              onClick={() => onAddToCart(entry)}
              disabled={cartAdding}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold shadow disabled:opacity-60 ${
                cartAdded
                  ? "bg-emerald-500 text-white"
                  : "bg-gradient-to-r from-bordeaux via-fuchsia-500 to-gold text-white"
              }`}
            >
              {cartAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ShoppingBag className="h-4 w-4" aria-hidden />
              )}
              {cartAdded ? "Ajouté au panier ✓" : "Ajouter au panier"}
            </button>
            <button
              type="button"
              onClick={() => onAgrandir(entry)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-bordeaux/15 transition-colors hover:bg-cream"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Agrandir
            </button>
            <AssistantShareActions
              resultUrl={entry.shareUrl ?? entry.resultUrl}
              shareTitle={entry.productTitle}
            />
          </div>
        </>
      )}

      {(isError || isInterrupted) && (
        <div className="space-y-2 px-3 py-3">
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-900 ring-1 ring-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="leading-snug">
              {entry.errorMessage ??
                "Je n’ai pas pu finaliser ce rendu. Vous pouvez réessayer."}
            </p>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(entry)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-bordeaux/10 px-3 py-2 text-xs font-semibold text-bordeaux ring-1 ring-bordeaux/20 transition-colors hover:bg-bordeaux/15"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Réessayer
            </button>
          )}
        </div>
      )}
    </motion.article>
  );
}

/**
 * Pending body — flat status panel embedded inside the card. No
 * outer purple bubble, no extra background, no chat messages — just
 * a single, dynamic indicator.
 */
function PendingBody({
  entry,
  liveProgress,
  liveStage,
}: {
  entry: TryOnHistoryEntry;
  liveProgress?: number;
  liveStage?: TryOnAssistantState["status"];
}) {
  const pct = Math.round(
    Math.max(entry.progress, liveProgress ?? 0)
  );
  const stage = liveStage ?? entry.stageStatus ?? "preparing";
  const label = mapTryOnStageToMessage(stage);

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-4 text-center">
      <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-bordeaux/10">
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-bordeaux/30"
          animate={{ scale: [1, 1.18, 1] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <Loader2 className="h-5 w-5 animate-spin text-bordeaux" aria-hidden />
      </div>

      <p className="text-xs font-semibold text-ink">{label}</p>

      <div className="flex items-baseline gap-1">
        <span className="font-display text-2xl font-semibold text-gradient">
          {pct}
        </span>
        <span className="text-xs font-medium text-ink-muted">%</span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-cream-dark">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-bordeaux via-fuchsia-500 to-gold"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function labelForCategory(category: TryOnHistoryEntry["category"]): string {
  switch (category) {
    case "watch":
      return "Montre";
    case "glasses":
      return "Lunettes";
    case "hand-jewelry":
      return "Bijou";
    case "headwear":
      return "Couvre-chef";
    case "clothes":
      return "Vêtement";
    default:
      return "Essai";
  }
}
