import type { CategoryId } from "@/types";

/**
 * Internal usage event tracker. Centralises the side-effect that happens
 * when a try-on is generated (free or paid). The MVP just logs to stdout —
 * future iterations will:
 *
 *   - persist events in a database (per merchant, per day)
 *   - enforce monthly quotas
 *   - power a merchant dashboard
 *   - feed Stripe metered billing
 *
 * IMPORTANT:
 *   - Never log the user photo, the result URL, or any secret.
 *   - Always return safely if `merchantId` is missing (anonymous demo).
 */

export interface TryOnUsageEvent {
  merchantId?: string;
  category: CategoryId;
  provider: string;
  model: string;
  mock: boolean;
  success: boolean;
  durationMs: number;
  errorCode?: string;
}

export function trackTryOnUsage(event: TryOnUsageEvent): void {
  // TODO(db): replace this with a non-blocking insert into the
  // `try_on_events` table once the persistence layer ships.
  const safe = {
    ts: new Date().toISOString(),
    merchantId: event.merchantId ?? "anon",
    category: event.category,
    provider: event.provider,
    model: event.model,
    mock: event.mock,
    success: event.success,
    durationMs: event.durationMs,
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  };

  // Single-line JSON for easy log ingestion.
  console.log("[trywithai.usage]", JSON.stringify(safe));
}
