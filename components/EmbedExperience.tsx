"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, ArrowLeft } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { detectCategoryFromTitle } from "@/lib/detectCategory";
import type { CategoryId, ProductItem } from "@/types";
import { CategoryCard } from "./CategoryCard";
import { TryOnPanel } from "./TryOnPanel";
import { EmbedFlow } from "./EmbedFlow";
import { generateId } from "@/lib/utils";

export function EmbedExperience() {
  const searchParams = useSearchParams();
  const productImage = searchParams.get("productImage");
  const productUrl = searchParams.get("productUrl");
  const productTitle = searchParams.get("productTitle");

  const detectedCategory = useMemo<CategoryId>(
    () => detectCategoryFromTitle(productTitle),
    [productTitle]
  );

  const [selectedId, setSelectedId] = useState<CategoryId | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "cabines:ready" }, "*");
    }
  }, []);

  const sendClose = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "cabines:close" }, "*");
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !selectedId) sendClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, sendClose]);

  const initialProducts: ProductItem[] = useMemo(() => {
    if (!productImage) return [];
    return [
      {
        id: generateId(),
        type: "url",
        value: productImage,
        previewUrl: productImage,
        source: "shopify",
        title: productTitle ?? undefined,
      },
    ];
  }, [productImage, productTitle]);

  const isAutoFlow = !!productImage;
  const selected = selectedId
    ? CATEGORIES.find((c) => c.id === selectedId)
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-cream to-cream-dark/40 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Cabine d&apos;essayage virtuelle
          </div>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink sm:text-3xl">
            {isAutoFlow
              ? "Essayez avant d'acheter"
              : "Choisissez la zone à essayer"}
          </h1>
        </div>

        {/* AUTO FLOW : article détecté → guide photo + upload + bouton */}
        {isAutoFlow && initialProducts[0] && (
          <EmbedFlow
            initialCategoryId={detectedCategory}
            product={initialProducts[0]}
            productTitle={productTitle}
            productImage={productImage}
          />
        )}

        {/* MANUAL FLOW : pas d'article détecté → grille de catégories */}
        {!isAutoFlow && !selected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="rounded-3xl border border-gold/20 bg-white/60 p-5 backdrop-blur-sm"
          >
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

        {!isAutoFlow && selected && (
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
