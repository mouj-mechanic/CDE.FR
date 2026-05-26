"use client";

import { Info } from "lucide-react";
import clsx from "clsx";

interface FidelityHintBannerProps {
  /** True when REQUIRE_MASK_FOR_OPENAI=true on the server. */
  requireMask?: boolean;
  /** True when no mask is currently attached (controls red-flag styling). */
  hasMask?: boolean;
  className?: string;
}

/**
 * Inline notice shown right before the "Lancer l'essayage" button so the
 * operator knows that mask precision drives fidelity.
 *
 *  - Always shown for the OpenAI provider (covers every category).
 *  - Switches to a red-bordered "mask required" variant when
 *    REQUIRE_MASK_FOR_OPENAI=true on the server and no mask is attached.
 */
export function FidelityHintBanner({
  requireMask = false,
  hasMask = false,
  className,
}: FidelityHintBannerProps) {
  const blocking = requireMask && !hasMask;
  return (
    <div
      className={clsx(
        "flex items-start gap-2 rounded-xl border p-3 text-xs",
        blocking
          ? "border-bordeaux/30 bg-bordeaux/5 text-bordeaux"
          : "border-ink-muted/15 bg-white/60 text-ink",
        className
      )}
      role={blocking ? "alert" : undefined}
    >
      <Info
        className={clsx(
          "mt-0.5 h-4 w-4 shrink-0",
          blocking ? "text-bordeaux" : "text-ink-muted"
        )}
        aria-hidden
      />
      <div className="flex-1 space-y-1">
        <p>
          Pour préserver le visage / la main et le produit, utilisez un masque
          précis. Plus le masque est large, plus l&apos;IA risque de modifier
          le client.
        </p>
        {blocking && (
          <p className="font-medium">
            Un masque est requis pour cette génération afin de préserver le
            client et l&apos;article.
          </p>
        )}
      </div>
    </div>
  );
}
