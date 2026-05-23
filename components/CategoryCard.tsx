"use client";

import { motion } from "framer-motion";
import type { Category } from "@/types";
import { CategoryIcon } from "./CategoryIcon";
import { cn } from "@/lib/utils";

interface CategoryCardProps {
  category: Category;
  dimmed: boolean;
  onSelect: () => void;
  layoutId: string;
}

export function CategoryCard({
  category,
  dimmed,
  onSelect,
  layoutId,
}: CategoryCardProps) {
  return (
    <motion.button
      type="button"
      layoutId={layoutId}
      onClick={onSelect}
      className={cn(
        "glass-card group relative w-full overflow-hidden p-6 text-left transition-all duration-500 sm:p-8",
        dimmed && "opacity-40 scale-[0.97]"
      )}
      whileHover={!dimmed ? { y: -4, boxShadow: "0 12px 40px -8px rgba(26, 20, 16, 0.15)" } : undefined}
      whileTap={!dimmed ? { scale: 0.98 } : undefined}
      aria-label={`Essayer : ${category.label}`}
    >
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gold/10 transition-transform duration-500 group-hover:scale-150" />

      <div className="relative flex flex-col gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bordeaux/10 text-bordeaux transition-colors group-hover:bg-bordeaux/15">
          <CategoryIcon name={category.iconName} className="h-7 w-7" />
        </div>

        <div>
          <h3 className="font-display text-xl font-semibold text-ink sm:text-2xl">
            {category.label}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {category.shortDescription}
          </p>
        </div>

        <span className="mt-2 inline-flex items-center text-sm font-medium text-bordeaux opacity-0 transition-opacity group-hover:opacity-100">
          Commencer →
        </span>
      </div>
    </motion.button>
  );
}
