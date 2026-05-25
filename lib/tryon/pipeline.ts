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
import { evaluatePreLandmarks, statusFromWarnings } from "./quality";
import { analyzeProduct, loadImageFromBlob } from "./productPrep";
import { getImageAlphaStats, inferImageMimeType } from "./alpha";
import {
  DEFAULT_WATCH_ADJUSTMENTS,
  renderWatchOverlay,
  type WatchAdjustments,
} from "./renderWatchOverlay";

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
      warnings,
      qualityStatus,
      renderMode,
      productHasAlpha,
      productMimeType: productResult.mimeType,
      productImageSource: productResult.source,
      watchPlacement,
      edgeQuality: watch.edgeQuality,
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

  if (placement && lm) {
    previewBlob = await renderOverlay({
      userImage: userImg,
      productImage: productImg,
      placement,
    });
    renderMode = opts.mode === "premium" ? "premium-ai" : "fast-overlay";
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

  return {
    previewBlob,
    previewBlobUrl,
    placement,
    landmarks: lm,
    warnings,
    qualityStatus: statusFromWarnings(warnings),
    renderMode,
    productHasAlpha,
    productMimeType: productResult.mimeType,
    productImageSource: productResult.source,
  };
}
