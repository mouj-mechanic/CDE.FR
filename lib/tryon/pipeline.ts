"use client";

/**
 * Try-on pipeline orchestrator (browser).
 *
 *  1. Load the user photo and the product image.
 *  2. Detect landmarks (face / hand) via MediaPipe.
 *  3. Compute deterministic placement.
 *  4. Render the overlay on `<canvas>` → JPEG blob.
 *  5. Return the preview + warnings + status.
 *
 *  For mode "fast"          → step 5 is the final result; no /api/try-on call.
 *  For mode "premium"/"auto" → the caller may upload the preview to fal for
 *                              local refinement (handled in TryOnPanel).
 */

import type {
  PipelineOptions,
  PipelineResult,
  PipelineWarning,
  ProductImageSource,
  RenderMode,
  WatchPlacementDescriptor,
} from "./types";
import { detectLandmarks, fileToImage } from "./landmarks";
import { computePlacement } from "./placement";
import { renderOverlay } from "./canvasRender";
import {
  dedupeWarnings,
  evaluatePreLandmarks,
  statusFromWarnings,
} from "./quality";
import { analyzeProduct, loadImageFromBlob } from "./productPrep";
import { getImageAlphaStats, inferImageMimeType } from "./alpha";
import {
  DEFAULT_WATCH_ADJUSTMENTS,
  renderWatchOverlay,
  type WatchAdjustments,
} from "./renderWatchOverlay";
import {
  renderWatchOverlayV3,
  getWatchRendererVersion,
  DEFAULT_WATCH_ADJUSTMENTS_V3,
  type WatchAdjustmentsV3,
} from "./watchRendererV3";
import { buildContactMask } from "./watchMask";

interface ProductLoadResult {
  image: HTMLImageElement;
  source: ProductImageSource;
  mimeType: string;
  /** Whether the *original input* (file/url) before any pipeline step had alpha. */
  inputHadAlpha: boolean;
}

async function fetchProductImage(
  cutoutUrl: string | null | undefined,
  productFile: File | null,
  productUrl: string | null | undefined
): Promise<ProductLoadResult | null> {
  // 1. If the upload itself is already transparent, prefer it — avoid an
  //    unnecessary cutout round trip and any risk of alpha degradation.
  if (productFile) {
    try {
      const stats = await getImageAlphaStats(productFile);
      if (stats.hasAlpha) {
        const image = await fileToImage(productFile);
        return {
          image,
          source: "transparent-upload",
          mimeType: inferImageMimeType(productFile),
          inputHadAlpha: true,
        };
      }
    } catch {
      // ignore — falls through to other paths
    }
  }

  // 2. Cutout URL produced by /api/product/cutout (always a transparent PNG).
  if (cutoutUrl) {
    try {
      const resp = await fetch(cutoutUrl);
      if (resp.ok) {
        const blob = await resp.blob();
        const image = await loadImageFromBlob(blob);
        return {
          image,
          source: "cutout",
          mimeType: "image/png",
          inputHadAlpha: true,
        };
      }
    } catch {
      // fall through
    }
  }

  // 3. Original upload (likely with a background).
  if (productFile) {
    const image = await fileToImage(productFile);
    return {
      image,
      source: "original",
      mimeType: inferImageMimeType(productFile),
      inputHadAlpha: false,
    };
  }

  // 4. Remote product URL.
  if (productUrl) {
    try {
      const resp = await fetch(productUrl);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const image = await loadImageFromBlob(blob);
      const stats = await getImageAlphaStats(image).catch(() => null);
      return {
        image,
        source: "original",
        mimeType: inferImageMimeType(productUrl),
        inputHadAlpha: stats?.hasAlpha ?? false,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export async function runTryOnPipeline(
  opts: PipelineOptions
): Promise<PipelineResult> {
  const warnings: PipelineWarning[] = [];

  const userImg = await fileToImage(opts.userFile);
  const productResult = await fetchProductImage(
    opts.productCutoutUrl,
    opts.productFile,
    opts.productUrl
  );
  if (!productResult) {
    throw new Error(
      "Image produit indisponible : impossible d'effectuer le rendu."
    );
  }
  const productImg = productResult.image;

  const productAnalysis = await analyzeProduct(productImg);
  const productHasAlpha =
    productResult.source === "cutout" ||
    productResult.source === "transparent-upload" ||
    productAnalysis.hasTransparency;

  if (!productHasAlpha) {
    warnings.push({
      code: "product-not-transparent",
      message:
        "L'image produit semble avoir un fond. Le rendu peut être moins réaliste. Privilégiez une image produit isolée, bien cadrée, idéalement sur fond transparent.",
    });
  }

  // Hard warning: alpha was expected (user uploaded a transparent PNG or we
  // ran a cutout) but the bitmap we loaded no longer has alpha.
  if (productResult.inputHadAlpha && !productAnalysis.hasTransparency) {
    warnings.push({
      code: "product-alpha-lost",
      message:
        "La transparence du produit a été perdue pendant le traitement. Réessayez avec le PNG original.",
    });
  }

  if (opts.category === "watch") {
    warnings.push({
      code: "remove-existing-accessory",
      message:
        "Pour un meilleur résultat, retirez la montre ou le bracelet existant avant l'essayage.",
    });
  } else if (opts.category === "hand-jewelry") {
    warnings.push({
      code: "remove-existing-accessory",
      message:
        "Retirez les bagues et bracelets existants pour éviter les artefacts.",
    });
  }

  const lm = await detectLandmarks(userImg, opts.category);
  const preCheck = evaluatePreLandmarks(lm);
  warnings.push(...preCheck.warnings);

  // ── Watch category uses a dedicated renderer (cylindrical warp + dual
  //    shadow + alpha refinement). The classic flat overlay is reserved for
  //    glasses / headwear / hand-jewelry.
  if (opts.category === "watch") {
    const rendererVersion = getWatchRendererVersion();
    // V3 is the orientation-aware single-layer renderer. It treats
    // the whole product as one canvas and rotates it as a whole —
    // correct for vertical-strap product photos (the dominant case
    // in real catalogues). V2 stays available for A/B tests via
    // WATCH_RENDERER_VERSION=v2.
    if (rendererVersion === "v3") {
      const adjV3: WatchAdjustmentsV3 = {
        ...DEFAULT_WATCH_ADJUSTMENTS_V3,
        ...(opts.watchAdjustments
          ? {
              offsetX: opts.watchAdjustments.offsetX,
              offsetY: opts.watchAdjustments.offsetY,
              scale: opts.watchAdjustments.scale,
              rotationDeg: opts.watchAdjustments.rotation
                ? (opts.watchAdjustments.rotation * 180) / Math.PI
                : undefined,
              shadowIntensity: opts.watchAdjustments.shadowIntensity,
            }
          : {}),
      };
      // Strip undefined keys so spread defaults kick in.
      const adjV3Rec = adjV3 as unknown as Record<string, unknown>;
      Object.keys(adjV3Rec).forEach((k) => {
        if (adjV3Rec[k] === undefined) delete adjV3Rec[k];
      });
      const watchV3 = await renderWatchOverlayV3({
        userImage: userImg,
        productImage: productImg,
        landmarks: lm,
        adjustments: adjV3,
      });
      if (!watchV3.fromLandmarks) {
        warnings.push({
          code: "landmarks-missing",
          message:
            "Poignet non détecté automatiquement. Ajustez la montre manuellement.",
        });
      } else if (watchV3.confidence < 0.45) {
        warnings.push({
          code: "low-confidence",
          message:
            "Ajustement manuel recommandé pour améliorer le placement.",
        });
      }
      if (watchV3.edgeQuality < 0.5) {
        warnings.push({
          code: "tight-crop",
          message:
            "Les contours du produit sont imparfaits. Le rendu peut être moins net.",
        });
      }
      const watchPlacement: WatchPlacementDescriptor = {
        x: watchV3.geometry.cx,
        y: watchV3.geometry.cy,
        width: watchV3.geometry.width,
        height: watchV3.geometry.height,
        scale: adjV3.scale,
        rotation: watchV3.geometry.rotation,
        curvature: 0,
        confidence: watchV3.confidence,
      };
      const renderMode: RenderMode = "fast-overlay";
      let qualityStatus = statusFromWarnings(warnings);
      if (
        qualityStatus === "passed" &&
        (!watchV3.fromLandmarks || watchV3.confidence < 0.45)
      ) {
        qualityStatus = "needs-better-photo";
      }
      // V3 deliberately does NOT expose a mask to the client. The
      // V3 composite IS the final image — there is no AI refinement
      // step. Returning `undefined` for maskBlob disables the
      // "Refine with AI" path in the UI, which is the correct
      // behaviour: any AI call on a watch would inevitably touch
      // hand / nail / finger pixels and damage the result. AI can
      // come back later via a server-side contact-shadow pass once
      // the deterministic V3 quality is reliable.
      return {
        previewBlob: watchV3.blob,
        previewBlobUrl: watchV3.url,
        placement: null,
        landmarks: lm,
        warnings: dedupeWarnings(warnings),
        qualityStatus,
        renderMode,
        productHasAlpha,
        productMimeType: productResult.mimeType,
        productImageSource: productResult.source,
        watchPlacement,
        edgeQuality: watchV3.edgeQuality,
      };
    }
    // ── V2 (legacy) — kept for opt-in A/B comparison ──────────────
    const adj: WatchAdjustments = {
      ...DEFAULT_WATCH_ADJUSTMENTS,
      ...(opts.watchAdjustments ?? {}),
    };
    const watch = await renderWatchOverlay({
      userImage: userImg,
      productImage: productImg,
      landmarks: lm,
      adjustments: adj,
    });

    if (!watch.fromLandmarks) {
      warnings.push({
        code: "landmarks-missing",
        message:
          "Poignet non détecté automatiquement. Ajustez la montre manuellement.",
      });
    } else if (watch.confidence < 0.45) {
      warnings.push({
        code: "low-confidence",
        message:
          "Ajustement manuel recommandé pour améliorer le placement.",
      });
    }

    if (watch.edgeQuality < 0.5) {
      warnings.push({
        code: "tight-crop",
        message:
          "Les contours du produit sont imparfaits. Le rendu peut être moins net.",
      });
    }

    const watchPlacement: WatchPlacementDescriptor = {
      x: watch.geometry.cx,
      y: watch.geometry.cy,
      width: watch.geometry.width,
      height: watch.geometry.height,
      scale: adj.scale,
      rotation: watch.geometry.rotation,
      curvature: adj.curvature,
      confidence: watch.confidence,
    };

    const renderMode: RenderMode = "fast-overlay";
    let qualityStatus = statusFromWarnings(warnings);
    if (
      qualityStatus === "passed" &&
      (!watch.fromLandmarks || watch.confidence < 0.45)
    ) {
      qualityStatus = "needs-better-photo";
    }

    return {
      previewBlob: watch.blob,
      previewBlobUrl: watch.url,
      placement: null,
      landmarks: lm,
      warnings: dedupeWarnings(warnings),
      qualityStatus,
      renderMode,
      productHasAlpha,
      productMimeType: productResult.mimeType,
      productImageSource: productResult.source,
      watchPlacement,
      edgeQuality: watch.edgeQuality,
      maskBlob: watch.maskBlob,
      maskBlobUrl: watch.maskUrl,
    };
  }

  const placement = lm
    ? computePlacement(lm, {
        handJewelryType: opts.handJewelryType,
        ringFinger: opts.ringFinger,
      })
    : null;

  // Decide what render to produce.
  let renderMode: RenderMode;
  let previewBlob: Blob;
  let maskBlob: Blob | undefined;
  let maskBlobUrl: string | undefined;

  if (placement && lm) {
    const render = await renderOverlay({
      userImage: userImg,
      productImage: productImg,
      placement,
    });
    previewBlob = render.blob;
    renderMode = opts.mode === "premium" ? "premium-ai" : "fast-overlay";

    // ── Auto-mask for OpenAI inpainting ────────────────────────────
    // glasses, headwear, hand-jewelry → derive a feathered contact-band
    // mask from the rendered silhouette so the customer never has to
    // upload one. Watch has its own dedicated mask (above).
    if (
      opts.category === "glasses" ||
      opts.category === "headwear" ||
      opts.category === "hand-jewelry"
    ) {
      try {
        // The silhouette is already drawn at the final position +
        // rotation, so the mask centre + rotation are simply the canvas
        // centre and 0. We rebuild the mask with the same builder used
        // by the watch flow so behaviour stays consistent.
        //
        // Feather is intentionally small (8–14 px) — anything bigger
        // bleeds onto neighbouring skin (forehead, cheeks, other
        // fingers) and the customer sees the mask as white halos in
        // the final image.
        const featherPx =
          opts.category === "headwear"
            ? 14
            : opts.category === "glasses"
              ? 10
              : 8;
        const mask = await buildContactMask({
          width: render.width,
          height: render.height,
          centerX: render.width / 2,
          centerY: render.height / 2,
          rotation: 0,
          silhouette: render.silhouette,
          featherPx,
          // No grounded patch for face/hand accessories — the feather
          // alone gives the AI enough room for natural shadows.
          groundedShadowPx: 0,
        });
        maskBlob = mask.blob;
        maskBlobUrl = mask.url;
      } catch (err) {
        console.warn("[tryon] auto-mask generation failed", err);
      }
    }
  } else {
    // Landmarks/placement failed → return the user photo as-is and let the
    // caller decide (e.g. fall back to AI-only generation server-side).
    previewBlob = await new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = userImg.naturalWidth || userImg.width;
      canvas.height = userImg.naturalHeight || userImg.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable."));
        return;
      }
      ctx.drawImage(userImg, 0, 0);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas export failed."))),
        "image/png"
      );
    });
    renderMode = opts.category === "clothes" ? "specialized-vton" : "mock";
  }

  const previewBlobUrl = URL.createObjectURL(previewBlob);
  const finalWarnings = dedupeWarnings(warnings);

  return {
    previewBlob,
    previewBlobUrl,
    placement,
    landmarks: lm,
    warnings: finalWarnings,
    qualityStatus: statusFromWarnings(finalWarnings),
    renderMode,
    productHasAlpha,
    productMimeType: productResult.mimeType,
    productImageSource: productResult.source,
    maskBlob,
    maskBlobUrl,
  };
}
