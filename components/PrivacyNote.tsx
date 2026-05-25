"use client";

import { Shield } from "lucide-react";
import { brand } from "@/lib/brand";

export function PrivacyNote() {
  const provider = process.env.NEXT_PUBLIC_AI_PROVIDER?.trim();
  const isReal = !!provider && provider.toLowerCase() !== "mock";

  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-light">
      <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
      <span>
        Vos photos sont utilisées <strong>uniquement</strong> pour générer cet
        aperçu d&apos;essayage
        {isReal
          ? ` (transmises temporairement au provider IA « ${provider} » pour traitement). ${brand.name} ne conserve pas vos photos sur ce MVP.`
          : ". En mode démo, aucune image n'est stockée."}
      </span>
    </p>
  );
}
