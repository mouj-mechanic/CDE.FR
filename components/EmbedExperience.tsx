"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, ArrowLeft } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import type { CategoryId, ProductItem } from "@/types";
import { CategoryCard } from "./CategoryCard";
import { TryOnPanel } from "./TryOnPanel";
import { generateId } from "@/lib/utils";

export function EmbedExperience() {
  const searchParams = useSearchParams();
  const productImage = searchParams.get("productImage");
  const productUrl = searchParams.get("productUrl");
  const productTitle = searchParams.get("productTitle");

  const [selectedId, setSelectedId] = useState<CategoryId | null>(null);

  const initialProducts: ProductItem[] = useMemo(() => {
    const items: ProductItem[] = [];
    if (productImage) {
      items.push({
        id: generateId(),
        type: "url",
        value: productImage,
        previewUrl: productImage,
        source: "shopify",
        title: productTitle ?? undefined,
      });
    }
    return items;
  }, [productImage, productTitle]);

  const sendClose = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "cabines:close" }, "*");
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "cabines:ready" }, "*");
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !selectedId) sendClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, sendClose]);

  const selected = selectedId
    ? CATEGORIES.find((c) => c.id === selectedId)
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-cream to-cream-dark/40 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        {/* Embed header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Cabine d&apos;essayage virtuelle
          </div>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink sm:text-3xl">
            {productTitle ? productTitle : "Essayez l'article virtuellement"}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {productImage
              ? "L'article est déjà chargé. Choisissez la zone à essayer."
              : "Essayez avant d'acheter, instantanément."}
          </p>
        </div>

        {productImage && !selectedId && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-6 flex items-center gap-4 rounded-2xl border border-gold/40 bg-gradient-to-r from-gold/10 to-transparent p-4 shadow-soft"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={productImage}
              alt={productTitle ?? "Article"}
              className="h-16 w-16 rounded-xl object-cover ring-1 ring-ink/10"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-bordeaux/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bordeaux">
                  Article de la boutique
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-medium text-ink">
                {productTitle ?? productImage}
              </p>
              <p className="text-xs text-ink-muted">
                Prêt pour l&apos;essayage virtuel
              </p>
            </div>
          </motion.div>
        )}

        {!selected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="rounded-3xl border border-gold/20 bg-white/60 p-5 backdrop-blur-sm"
          >
            <div className="mb-4 flex items-center gap-2 text-sm text-bordeaux">
              <Sparkles className="h-4 w-4 text-gold" aria-hidden />
              <span className="font-medium">
                Choisissez la zone à essayer
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CATEGORIES.map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  layoutId={`embed-card-${category.id}`}
                  dimmed={false}
                  onSelect={() => setSelectedId(category.id)}
                />
              ))}
            </div>
          </motion.div>
        )}

        {selected && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="btn-ghost text-sm"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Changer de catégorie
            </button>
            <TryOnPanel
              key={selected.id}
              category={selected}
              onClose={() => setSelectedId(null)}
              initialProducts={initialProducts}
            />
          </div>
        )}

        {/* Branding footer */}
        <p className="mt-8 text-center text-xs text-ink-light">
          Propulsé par{" "}
          <a
            href="https://cabinesdessayage.fr"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-bordeaux hover:underline"
          >
            CabinesDEssayage.fr
          </a>
        </p>
      </div>
    </div>
  );
}
