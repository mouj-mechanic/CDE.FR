/**
 * Pre / post quality validation.
 *
 *  Pre-checks run on the detected landmarks before we generate anything.
 *  They produce warnings that surface in the UI (e.g. "Repositionnez votre
 *  poignet, votre main n'est pas entièrement visible").
 *
 *  Post-checks could re-run landmark detection on the AI-refined result and
 *  decide whether to keep it or fall back to the deterministic preview.
 *  For now we expose the API and a minimal implementation that compares the
 *  result hash against the user-photo hash to catch the "image unchanged"
 *  failure mode that FLUX Kontext exhibits occasionally.
 */

import type {
  PipelineWarning,
  QualityStatus,
  TryOnLandmarks,
} from "./types";

export function evaluatePreLandmarks(
  lm: TryOnLandmarks | null
): { ok: boolean; warnings: PipelineWarning[] } {
  const warnings: PipelineWarning[] = [];
  if (!lm) {
    warnings.push({
      code: "landmarks-missing",
      message:
        "Position cible non détectée. Reprenez une photo mieux cadrée et bien éclairée.",
    });
    return { ok: false, warnings };
  }

  // Visibility / off-axis heuristics — both face & hand landmarkers expose
  // approximate visibility for each point. If too few are confident, warn.
  const points = lm.face ?? lm.hand ?? [];
  const visible = points.filter(
    (p) => p.visibility === undefined || p.visibility > 0.4
  ).length;
  if (points.length > 0 && visible / points.length < 0.7) {
    warnings.push({
      code: "low-confidence",
      message:
        "La zone cible est partiellement masquée ou mal éclairée. Le résultat peut être imparfait.",
    });
  }

  return { ok: true, warnings };
}

/**
 * Remove duplicate warning codes, keeping the **last** message for each code.
 * Later pipeline stages (e.g. watch-specific placement) produce more
 * actionable messages than earlier generic pre-checks.
 */
export function dedupeWarnings(
  warnings: PipelineWarning[]
): PipelineWarning[] {
  const byCode = new Map<string, PipelineWarning>();
  for (const w of warnings) {
    byCode.set(w.code, w);
  }
  return Array.from(byCode.values());
}

export function statusFromWarnings(
  warnings: PipelineWarning[]
): QualityStatus {
  if (warnings.some((w) => w.code === "landmarks-missing"))
    return "needs-better-photo";
  if (warnings.some((w) => w.code === "premium-validation-failed"))
    return "fallback-preview";
  return "passed";
}
