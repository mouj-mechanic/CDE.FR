"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { CategoryId, ProductItem } from "@/types";
import { isValidCategoryId } from "@/lib/categories";
import { detectCategoryFromTitle } from "@/lib/detectCategory";
import { generateId, resolveMediaUrl } from "@/lib/utils";
import { TryOnAssistantExperience } from "./assistant/TryOnAssistantExperience";

/**
 * Bubble-only embed entry point. Renders ONLY the floating assistant
 * bubble — no big modal, no card layout, no extra header. The bubble
 * is the experience: photo upload, instructions, consent, launch,
 * progress, result image, cart/share actions all live inside it.
 *
 * URL contract (unchanged):
 *   /embed?productImage=…&productUrl=…&productTitle=…&category=…&merchantId=…
 */
export function EmbedExperience() {
  const searchParams = useSearchParams();
  const productImageRaw = searchParams.get("productImage");
  const productImage = useMemo(
    () => resolveMediaUrl(productImageRaw),
    [productImageRaw]
  );
  const productUrl = searchParams.get("productUrl");
  const productTitle = searchParams.get("productTitle");
  const categoryParam = searchParams.get("category");
  const merchantId = searchParams.get("merchantId");

  const detectedCategory = useMemo<CategoryId>(() => {
    if (categoryParam && isValidCategoryId(categoryParam)) {
      return categoryParam;
    }
    return detectCategoryFromTitle(productTitle);
  }, [categoryParam, productTitle]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      // Announce ready for both modern and legacy parents.
      window.parent.postMessage({ type: "TRYWITHAI_READY" }, "*");
      window.parent.postMessage({ type: "cabines:ready" }, "*");
    }
  }, []);

  const sendClose = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "TRYWITHAI_CLOSE" }, "*");
      window.parent.postMessage({ type: "cabines:close" }, "*");
    }
  }, []);

  const product: ProductItem | undefined = productImage
    ? {
        id: generateId(),
        type: "url",
        value: productImage,
        previewUrl: productImage,
        source: "shopify",
        title: productTitle ?? undefined,
      }
    : productUrl
      ? {
          id: generateId(),
          type: "url",
          value: productUrl,
          source: "unknown",
          title: productTitle ?? undefined,
        }
      : undefined;

  const handleOpenLightbox = useCallback((resultUrl: string) => {
    // Open the rendered image in a new tab so the customer can pinch-
    // zoom / right-click save without losing the bubble state.
    if (typeof window !== "undefined") {
      window.open(resultUrl, "_blank", "noopener,noreferrer");
    }
  }, []);

  return (
    // Transparent root: the bubble is the only visible UI. The
    // surrounding embed page has no chrome — clicks pass through to
    // the merchant page when delivered as a transparent iframe.
    <div
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden={false}
    >
      <div className="pointer-events-auto">
        <TryOnAssistantExperience
          initialCategoryId={detectedCategory}
          product={product}
          productTitle={productTitle}
          productImage={productImage}
          merchantId={merchantId}
          onClose={sendClose}
          onOpenLightbox={handleOpenLightbox}
        />
      </div>
    </div>
  );
}
