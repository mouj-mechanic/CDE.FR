/**
 * Pipeline-aware progress simulation for the try-on assistant bubble.
 *
 * The API call takes 15–40 s (OpenAI image edit) but the customer needs
 * IMMEDIATE feedback. We drive a soft progress curve client-side that
 * lands at ~92% and waits there for the real response. When the API
 * resolves we snap to 100%.
 *
 * Stages are intentionally generic — the API/pipeline never has to
 * report back exactly which step it is on (which is hard, since the
 * server is a black box). The numbers are chosen to feel honest:
 *
 *  0–10%   préparation
 *  10–25%  analyse photo
 *  25–45%  préparation produit
 *  45–65%  placement
 *  65–85%  génération
 *  85–92%  vérification qualité
 *  100%    prêt (snapped on real response)
 */

import type {
  CategoryId,
  TryOnAssistantStatus,
} from "@/types";

export interface AssistantStage {
  status: TryOnAssistantStatus;
  /** End-of-stage progress percentage (0..100). */
  endProgress: number;
  /** Estimated duration in ms — the simulator interpolates linearly. */
  durationMs: number;
  message: string;
}

const COMMON_STAGES: AssistantStage[] = [
  {
    status: "preparing",
    endProgress: 10,
    durationMs: 800,
    message: "Je prépare votre simulation IA…",
  },
  {
    status: "analyzing_photo",
    endProgress: 25,
    durationMs: 3500,
    message: "J’analyse votre photo pour trouver la bonne zone.",
  },
  {
    status: "preparing_product",
    endProgress: 45,
    durationMs: 4500,
    message: "Je prépare le produit pour le poser proprement.",
  },
  {
    status: "placing_product",
    endProgress: 65,
    durationMs: 5500,
    message: "J’ajuste la position et la perspective.",
  },
  {
    status: "generating",
    endProgress: 85,
    durationMs: 10000,
    message: "Je peaufine le rendu avec l’IA…",
  },
  {
    status: "quality_check",
    endProgress: 92,
    durationMs: 4000,
    message: "Je vérifie que votre photo et le produit restent fidèles.",
  },
];

/**
 * Returns the canonical timeline for a category. We keep the same set
 * of stages across categories for now — only the wording could differ
 * later (clothes → "préparation de la coupe", glasses → "ajustement
 * sur le visage", …).
 */
export function createAssistantTimeline(
  _category: CategoryId
): AssistantStage[] {
  return COMMON_STAGES.slice();
}

export interface SimulatedProgressHandle {
  stop(): void;
}

export interface SimulatedProgressEvent {
  status: TryOnAssistantStatus;
  progress: number;
  message: string;
}

/**
 * Start a soft client-side progress simulator. Calls `onTick` on every
 * frame with the latest status / progress / message. Stops when the
 * caller calls `stop()` OR when the simulator reaches 92% (it then
 * sits there silently, waiting for the real response).
 */
export function startSimulatedProgress(
  category: CategoryId,
  onTick: (event: SimulatedProgressEvent) => void
): SimulatedProgressHandle {
  const stages = createAssistantTimeline(category);
  let cancelled = false;
  let raf = 0;
  const startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());

  const totalDurationMs = stages.reduce((sum, s) => sum + s.durationMs, 0);

  function step() {
    if (cancelled) return;
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = now - startedAt;

    // Find current stage based on elapsed.
    let cumulative = 0;
    let stageIdx = 0;
    let stageStart = 0;
    for (let i = 0; i < stages.length; i++) {
      const next = cumulative + stages[i].durationMs;
      if (elapsed <= next) {
        stageIdx = i;
        stageStart = cumulative;
        break;
      }
      cumulative = next;
      stageIdx = i;
      stageStart = cumulative - stages[i].durationMs;
    }

    const stage = stages[stageIdx];
    const stageStartProgress =
      stageIdx === 0 ? 0 : stages[stageIdx - 1].endProgress;
    const stageEndProgress = stage.endProgress;
    const localElapsed = elapsed - stageStart;
    const localT = Math.min(1, localElapsed / Math.max(stage.durationMs, 1));
    const progress =
      stageStartProgress +
      (stageEndProgress - stageStartProgress) * localT;

    onTick({
      status: stage.status,
      progress: Math.min(progress, stages[stages.length - 1].endProgress),
      message: stage.message,
    });

    if (elapsed >= totalDurationMs) {
      // We reached the cap (92%). Stop scheduling further ticks but
      // keep the handle "alive" — the caller will explicitly snap to
      // 100% when the real result arrives.
      return;
    }

    raf =
      typeof window !== "undefined" && window.requestAnimationFrame
        ? window.requestAnimationFrame(step)
        : 0;
  }

  raf =
    typeof window !== "undefined" && window.requestAnimationFrame
      ? window.requestAnimationFrame(step)
      : 0;

  return {
    stop() {
      cancelled = true;
      if (
        raf &&
        typeof window !== "undefined" &&
        window.cancelAnimationFrame
      ) {
        window.cancelAnimationFrame(raf);
      }
    },
  };
}

/**
 * Translate a server-side pipeline event into a customer-friendly
 * message. Kept here so the wording lives in one place.
 */
export function mapTryOnStageToMessage(
  status: TryOnAssistantStatus
): string {
  switch (status) {
    case "preparing":
      return "Je prépare votre simulation IA…";
    case "analyzing_photo":
      return "J’analyse votre photo pour trouver la bonne zone.";
    case "preparing_product":
      return "Je prépare le produit pour le poser proprement.";
    case "placing_product":
      return "J’ajuste la position et la perspective.";
    case "generating":
      return "Je peaufine le rendu avec l’IA…";
    case "quality_check":
      return "Je vérifie que votre photo et le produit restent fidèles.";
    case "ready":
      return "Votre simulation est prête ✨";
    case "fallback_ready":
      return "J’ai privilégié le rendu le plus fidèle pour préserver votre photo et le produit.";
    case "error":
      return "Je n’ai pas pu finaliser ce rendu. Vous pouvez réessayer avec une photo plus nette ou essayer un autre modèle.";
    default:
      return "";
  }
}
