"use client";

import { motion } from "framer-motion";
import { Eye, Loader2, ShoppingBag, Sparkles } from "lucide-react";
import type { TryOnHistoryEntry } from "@/types";
import { AssistantShareActions } from "./AssistantShareActions";

interface HistoryCardProps {
  entry: TryOnHistoryEntry;
  /**
   * Indicates this is the most recent entry — gets a subtle accent
   * so the customer's eye lands on the current PDP's try-on first.
   */
  isLatest?: boolean;
  onAddToCart(entry: TryOnHistoryEntry): void;
  onAgrandir(entry: TryOnHistoryEntry): void;
}

/**
 * A self-contained "card" for one completed try-on. Renders inside
 * the bubble's scrollable feed. Each card carries its own add-to-cart
 * status, share menu and Agrandir button so the customer can act on
 * any past try-on, not just the latest one.
 */
export function HistoryCard({
  entry,
  isLatest,
  onAddToCart,
  onAgrandir,
}: HistoryCardProps) {
  const cartAdding = entry.cartStatus === "adding";
  const cartAdded = entry.cartStatus === "added";

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`overflow-hidden rounded-2xl border ${
        isLatest
          ? "border-bordeaux/30 bg-white shadow-soft"
          : "border-ink/10 bg-white/95"
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
            {isLatest && " · article en cours"}
          </p>
        </div>
      </div>

      {/* Result image — click to agrandir */}
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

      {/* Opinion */}
      <div className="bg-gold/10 px-3 py-2 text-xs leading-snug text-ink">
        {entry.opinion}
      </div>

      {/* Actions */}
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
    </motion.article>
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
