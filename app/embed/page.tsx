import { Suspense } from "react";
import { EmbedExperience } from "@/components/EmbedExperience";

export const dynamic = "force-dynamic";

function EmbedLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream">
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-bordeaux/20 border-t-bordeaux"
        aria-hidden
      />
      <p className="font-display text-lg text-bordeaux">
        Ouverture de la cabine…
      </p>
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
