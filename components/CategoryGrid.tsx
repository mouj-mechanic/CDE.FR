"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup } from "framer-motion";
import { CATEGORIES } from "@/lib/categories";
import type { Category, CategoryId } from "@/types";
import { CategoryCard } from "./CategoryCard";
import { TryOnPanel } from "./TryOnPanel";

export function CategoryGrid() {
  const [selectedId, setSelectedId] = useState<CategoryId | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedCategory: Category | undefined = selectedId
    ? CATEGORIES.find((c) => c.id === selectedId)
    : undefined;

  const handleSelect = useCallback((id: CategoryId) => {
    setSelectedId(id);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedId(null);
  }, []);

  useEffect(() => {
    if (selectedId && panelRef.current) {
      const timer = setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [selectedId]);

  return (
    <LayoutGroup>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((category) => {
          if (selectedId === category.id) return null;
          return (
            <CategoryCard
              key={category.id}
              category={category}
              layoutId={`card-${category.id}`}
              dimmed={selectedId !== null}
              onSelect={() => handleSelect(category.id)}
            />
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {selectedCategory && selectedId && (
          <div ref={panelRef} className="mt-8">
            <TryOnPanel
              key={selectedId}
              category={selectedCategory}
              onClose={handleClose}
            />
          </div>
        )}
      </AnimatePresence>
    </LayoutGroup>
  );
}
