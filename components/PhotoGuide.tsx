"use client";

import { motion } from "framer-motion";
import { Camera, CheckCircle2 } from "lucide-react";
import type { Category, CategoryId } from "@/types";
import { PhotoGuideIllustration } from "./PhotoGuideIllustration";

interface PhotoGuideProps {
  category: Category;
}

export function PhotoGuide({ category }: PhotoGuideProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bordeaux/10 text-bordeaux">
          <Camera className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3 className="font-display text-xl font-semibold text-ink">
            Guide photo
          </h3>
          <p className="text-sm text-ink-muted">
            Zone cible : {category.bodyTarget}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <PhotoGuideIllustration categoryId={category.id as CategoryId} />

        <ul className="flex-1 space-y-3" role="list">
          {category.photoInstructions.map((instruction, index) => (
            <motion.li
              key={instruction}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.08 }}
              className="flex items-start gap-3 text-sm text-ink-muted"
            >
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-gold"
                aria-hidden
              />
              <span>{instruction}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}
