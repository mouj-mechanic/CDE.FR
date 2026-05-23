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
      });
    }
    if (productUrl && productUrl !== productImage) {
      items.push({
        id: generateId(),
        type: "url",
        value: productUrl,
      });
    }
    return items;
  }, [productImage, productUrl]);

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
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-2xl font-semibold text-bordeaux sm:text-3xl">
              Cabine d&apos;essayage virtuelle
            </p>
            <p className="text-sm text-ink-muted">
              {productTitle
                ? `Article : ${productTitle}`
                : "Essayez avant d'acheter, instantanément."}
            </p>
          </div>
          {productImage && !selectedId && (
            <div className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-3 shadow-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={productImage}
                alt={productTitle ?? "Article"}
                className="h-12 w-12 rounded-lg object-cover"
              />
              <div className="text-left">
                <p className="text-xs font-medium text-ink">
                  Article pré-rempli
                </p>
                <p className="text-xs text-ink-muted">
                  prêt pour l&apos;essayage
                </p>
              </div>
            </div>
          )}
        </div>

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
