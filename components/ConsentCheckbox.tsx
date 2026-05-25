"use client";

import { Lock } from "lucide-react";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ConsentCheckbox({ checked, onChange }: Props) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-bordeaux/15 bg-white/70 p-4 text-sm text-ink backdrop-blur-sm transition-colors hover:bg-white/90">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-bordeaux"
        aria-describedby="consent-help"
      />
      <span>
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Lock className="h-3.5 w-3.5 text-bordeaux" aria-hidden />
          J&apos;accepte que ma photo soit utilisée pour générer cet aperçu
          IA.
        </span>
        <span id="consent-help" className="mt-1 block text-xs text-ink-muted">
          Votre photo est traitée le temps de la génération. Aucun stockage
          permanent côté serveur dans ce MVP.
        </span>
      </span>
    </label>
  );
}
