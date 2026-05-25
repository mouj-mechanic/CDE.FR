"use client";

import { Gem, Circle } from "lucide-react";
import type { FingerId, HandJewelryType } from "@/types";
import { cn } from "@/lib/utils";

interface HandJewelryOptionsProps {
  type: HandJewelryType;
  onTypeChange: (t: HandJewelryType) => void;
  finger: FingerId;
  onFingerChange: (f: FingerId) => void;
}

const FINGERS: { id: FingerId; label: string }[] = [
  { id: "index", label: "Index" },
  { id: "middle", label: "Majeur" },
  { id: "ring", label: "Annulaire" },
  { id: "pinky", label: "Auriculaire" },
];

export function HandJewelryOptions({
  type,
  onTypeChange,
  finger,
  onFingerChange,
}: HandJewelryOptionsProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-ink/10 bg-white/70 p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Type de bijou
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onTypeChange("ring")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all",
              type === "ring"
                ? "border-bordeaux bg-bordeaux/5 text-bordeaux shadow-soft"
                : "border-ink/10 bg-white text-ink hover:border-bordeaux/30"
            )}
            aria-pressed={type === "ring"}
          >
            <Circle className="h-4 w-4" aria-hidden />
            Bague
          </button>
          <button
            type="button"
            onClick={() => onTypeChange("bracelet")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all",
              type === "bracelet"
                ? "border-bordeaux bg-bordeaux/5 text-bordeaux shadow-soft"
                : "border-ink/10 bg-white text-ink hover:border-bordeaux/30"
            )}
            aria-pressed={type === "bracelet"}
          >
            <Gem className="h-4 w-4" aria-hidden />
            Bracelet
          </button>
        </div>
      </div>

      {type === "ring" && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Doigt cible
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {FINGERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFingerChange(f.id)}
                className={cn(
                  "rounded-xl border px-2 py-2 text-xs font-medium transition-all",
                  finger === f.id
                    ? "border-bordeaux bg-bordeaux/5 text-bordeaux shadow-soft"
                    : "border-ink/10 bg-white text-ink hover:border-bordeaux/30"
                )}
                aria-pressed={finger === f.id}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            La bague sera placée uniquement sur ce doigt.
          </p>
        </div>
      )}
    </div>
  );
}
