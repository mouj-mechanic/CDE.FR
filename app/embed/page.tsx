import { Suspense } from "react";
import { EmbedExperience } from "@/components/EmbedExperience";

export const dynamic = "force-dynamic";

export default function EmbedPage() {
  return (
    <Suspense fallback={null}>
      <EmbedExperience />
    </Suspense>
  );
}
