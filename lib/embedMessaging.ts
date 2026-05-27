/**
 * Tiny helper to post structured messages from the TryWithAI iframe up
 * to the parent storefront. Used to drive the parent bubble + Shopify
 * cart integration without ever coupling the iframe React code to a
 * specific shop URL.
 *
 * Every message includes `source: "trywithai"` so the parent listener
 * can ignore unrelated events (Stripe, Klaviyo, Shopify checkout, …).
 */

import type { CategoryId, SharePlatform } from "@/types";

export type EmbedMessageType =
  | "TRYWITHAI_READY"
  | "TRYWITHAI_CLOSE"
  | "TRYWITHAI_JOB_STARTED"
  | "TRYWITHAI_JOB_PROGRESS"
  | "TRYWITHAI_JOB_READY"
  | "TRYWITHAI_JOB_ERROR"
  | "TRYWITHAI_MINIMIZE"
  | "TRYWITHAI_RESTORE"
  | "TRYWITHAI_ADD_TO_CART"
  | "TRYWITHAI_SHARE"
  | "TRYWITHAI_OPEN_RESULT"
  // Parent -> iframe replies
  | "TRYWITHAI_CART_ADDED"
  | "TRYWITHAI_CART_ERROR"
  | "TRYWITHAI_SHARE_DONE"
  | "TRYWITHAI_SHARE_ERROR";

export interface JobStartedPayload {
  jobId: string;
  category: CategoryId | string;
  productTitle?: string;
  productUrl?: string;
  productImage?: string;
  message: string;
}

export interface JobProgressPayload {
  jobId: string;
  status: string;
  progress: number;
  message?: string;
}

export interface JobReadyPayload {
  jobId: string;
  resultUrl: string;
  shareUrl?: string;
  productTitle?: string;
  category: CategoryId | string;
  opinion: string;
  qualityStatus?: string;
  fallbackUsed?: boolean;
}

export interface JobErrorPayload {
  jobId: string;
  message: string;
}

export interface AddToCartPayload {
  jobId?: string;
  resultUrl?: string;
  productTitle?: string;
  /**
   * Stable identifier of the bubble's history entry being added.
   * The host MUST echo it back in TRYWITHAI_CART_ADDED /
   * TRYWITHAI_CART_ERROR so the iframe knows which card to update —
   * critical now that the bubble holds multiple try-on cards at once.
   */
  entryId?: string;
}

export interface SharePayload {
  platform: SharePlatform;
  resultUrl: string;
  text: string;
  title: string;
}

export function postToParent(type: EmbedMessageType, payload?: unknown) {
  if (typeof window === "undefined") return;
  if (window.parent === window) return;
  try {
    window.parent.postMessage(
      { type, payload, source: "trywithai" },
      "*"
    );
  } catch {
    /* parent unreachable — fail silently */
  }
}

/** Strongly-typed helper for the JOB_STARTED message. */
export function postJobStarted(payload: JobStartedPayload) {
  postToParent("TRYWITHAI_JOB_STARTED", payload);
}

export function postJobProgress(payload: JobProgressPayload) {
  postToParent("TRYWITHAI_JOB_PROGRESS", payload);
}

export function postJobReady(payload: JobReadyPayload) {
  postToParent("TRYWITHAI_JOB_READY", payload);
}

export function postJobError(payload: JobErrorPayload) {
  postToParent("TRYWITHAI_JOB_ERROR", payload);
}

export function postMinimize() {
  postToParent("TRYWITHAI_MINIMIZE");
}

export function postRestore() {
  postToParent("TRYWITHAI_RESTORE");
}

export function postAddToCart(payload: AddToCartPayload) {
  postToParent("TRYWITHAI_ADD_TO_CART", payload);
}

export function postShare(payload: SharePayload) {
  postToParent("TRYWITHAI_SHARE", payload);
}

/** Generate a stable-ish job id (no crypto dependency to keep the bundle small). */
export function generateJobId(): string {
  return (
    "job_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}
