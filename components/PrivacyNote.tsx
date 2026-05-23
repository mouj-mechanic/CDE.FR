import { Shield } from "lucide-react";

export function PrivacyNote() {
  const provider = process.env.NEXT_PUBLIC_AI_PROVIDER?.trim();
  const isReal = !!provider;

  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-light">
      <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
      <span>
        Vos images sont utilisées uniquement pour générer votre essayage
        {isReal
          ? ` (transmises au provider IA "${provider}" pour traitement, puis non conservées par CabinesDEssayage.fr).`
          : " et ne sont pas stockées dans ce MVP."}
      </span>
    </p>
  );
}
