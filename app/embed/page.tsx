import { Suspense } from "react";
import { EmbedExperience } from "@/components/EmbedExperience";

export const dynamic = "force-dynamic";

// The embed surface is transparent and pointer-events-none on the
// root so clicks pass through to the merchant page. Only the bubble
// itself reactivates pointer events.
function EmbedLoading() {
  return (
    <div className="pointer-events-none fixed inset-0 flex items-end justify-end p-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-bordeaux shadow-lifted">
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-bordeaux/20 border-t-bordeaux"
          aria-hidden
        />
        Ouverture…
      </div>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={<EmbedLoading />}>
      <EmbedExperience />
    </Suspense>
  );
}
