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
      whileHover={!dimmed ? { y: -4, boxShadow: "0 16px 48px -10px rgba(124, 58, 237, 0.28)" } : undefined}
      whileTap={!dimmed ? { scale: 0.98 } : undefined}
      aria-label={`Essayer : ${category.label}`}
    >
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-gold/30 to-bordeaux/20 blur-2xl transition-transform duration-500 group-hover:scale-150" />
      <div className="absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-gradient-to-tr from-bordeaux/20 to-peach/30 blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

      <div className="relative flex flex-col gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-bordeaux/20 via-fuchsia-200/50 to-gold/25 text-bordeaux transition-all duration-300 group-hover:scale-110 group-hover:shadow-glow">
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
