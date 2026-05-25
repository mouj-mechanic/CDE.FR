"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, ArrowLeft } from "lucide-react";
import { CATEGORIES, isValidCategoryId } from "@/lib/categories";
import { detectCategoryFromTitle } from "@/lib/detectCategory";
import type { CategoryId, ProductItem } from "@/types";
import { CategoryCard } from "./CategoryCard";
import { TryOnPanel } from "./TryOnPanel";
import { EmbedFlow } from "./EmbedFlow";
import { generateId, resolveMediaUrl } from "@/lib/utils";
import { brand } from "@/lib/brand";

export function EmbedExperience() {
  const searchParams = useSearchParams();
  const productImageRaw = searchParams.get("productImage");
  const productImage = useMemo(
    () => resolveMediaUrl(productImageRaw),
    [productImageRaw]
  );
  const productUrl = searchParams.get("productUrl");
  const productTitle = searchParams.get("productTitle");
  const categoryParam = searchParams.get("category");
  const merchantId = searchParams.get("merchantId");

  const detectedCategory = useMemo<CategoryId>(() => {
    if (categoryParam && isValidCategoryId(categoryParam)) {
      return categoryParam;
    }
    return detectCategoryFromTitle(productTitle);
  }, [categoryParam, productTitle]);

  const [selectedId, setSelectedId] = useState<CategoryId | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      // Announce ready to both naming conventions for backward compat
      window.parent.postMessage({ type: "TRYWITHAI_READY" }, "*");
      window.parent.postMessage({ type: "cabines:ready" }, "*");
    }
  }, []);

  const sendClose = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "TRYWITHAI_CLOSE" }, "*");
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
  // If category is explicitly provided but no product image, we still preselect.
  const isCategoryPreselected =
    !isAutoFlow && !!categoryParam && isValidCategoryId(categoryParam);
  const selected =
    selectedId || (isCategoryPreselected ? (categoryParam as CategoryId) : null);
  const selectedCategory = selected
    ? CATEGORIES.find((c) => c.id === selected)
    : null;

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-bordeaux">
            <Sparkles className="h-3.5 w-3.5 text-gold" aria-hidden />
            {brand.name}
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
            <span className="text-ink">
              {isAutoFlow
                ? "Essayez avant d'acheter"
                : "Choisissez la zone à essayer"}
            </span>
          </h1>
        </div>

        {/* AUTO FLOW : product detected → guide + upload + launch */}
        {isAutoFlow && initialProducts[0] && (
          <EmbedFlow
            initialCategoryId={detectedCategory}
            product={initialProducts[0]}
            productTitle={productTitle}
            productImage={productImage}
            merchantId={merchantId}
          />
        )}

        {/* MANUAL FLOW : no product → categories grid */}
        {!isAutoFlow && !selectedCategory && (
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

        {!isAutoFlow && selectedCategory && (
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
              key={selectedCategory.id}
              category={selectedCategory}
              onClose={() => setSelectedId(null)}
              merchantId={merchantId}
              initialProducts={
                productUrl
                  ? [
                      {
                        id: generateId(),
                        type: "url",
                        value: productUrl,
                        source: "unknown",
                        title: productTitle ?? undefined,
                      },
                    ]
                  : undefined
              }
            />
          </div>
        )}

        <p className="mt-8 text-center text-xs text-ink-light">
          Propulsé par{" "}
          <a
            href={brand.appDomain}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-bordeaux hover:underline"
          >
            {brand.name}
          </a>
        </p>
      </div>
    </div>
  );
}
