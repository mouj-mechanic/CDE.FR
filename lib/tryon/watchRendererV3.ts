"use client";

/**
 * Watch Renderer V3 — orientation-aware single-layer pipeline.
 *
 *  The v2 renderer (renderWatchOverlay.ts) was designed for "horizontal
 *  strap" product images — strap going LEFT to RIGHT in the PNG. It
 *  splits the product into leftStrap / dial / rightStrap and warps
 *  each piece with a parabolic curvature around the wrist axis.
 *
 *  In practice 90 %+ of catalogue watch photos are VERTICAL: strap
 *  going TOP to BOTTOM (12h dial at the top, 6h at the bottom). Feeding
 *  such a product into the v2 renderer cuts through the dial and warps
 *  the case sideways — that's the root cause of the "watch stays
 *  vertical / sticker effect" feedback.
 *
 *  V3 is intentionally simpler and safer:
 *
 *    1. Detect product orientation from its alpha bounding box.
 *    2. Define `productStrapAxisDeg` (90° for vertical strap, 0° for
 *       horizontal strap, unknown → assume vertical).
 *    3. Compute the forearm direction from MediaPipe landmarks.
 *    4. Final rotation = forearmAxisDeg - productStrapAxisDeg.
 *    5. Apply the rotation to the WHOLE product layer (no
 *       segmentation, no horizontal warp).
 *    6. Place on the wrist (styloid process anchor).
 *    7. Add a soft drop shadow under the case.
 *    8. Composite onto the user image.
 *    9. Generate a contact-band B/W mask for downstream consumers.
 *
 *  V3 NEVER calls the AI provider — it is the deterministic
 *  composite that ships when `WATCH_USE_OPENAI_CONTACT_BLEND=false`.
 *  The API route can still add IA contact shadows when the operator
 *  flips the kill switch, but the customer-facing rendering is
 *  guaranteed to be V3 alone.
 */

import { refineAlphaMask } from "./alphaRefine";
import {
  computeWristGeometry,
  fallbackWristGeometry,
  type WristGeometry,
} from "./watchGeometry";
import {
  computeWatchRotation,
  forceMinimumRotationForDiagonalForearm,
  checkWatchRotationQuality,
  normalizeAngle180,
  type WatchRotationResult,
} from "./watchRotation";
import type { TryOnLandmarks } from "./types";

// ──────────────────────────────────────────────────────────────────────
//  Public surface — mirrors WatchRenderResult shape so pipeline.ts can
//  swap V2 ↔ V3 without ripple changes.
// ──────────────────────────────────────────────────────────────────────

export interface WatchAdjustmentsV3 {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotationDeg: number;
  shadowIntensity: number;
}

export const DEFAULT_WATCH_ADJUSTMENTS_V3: WatchAdjustmentsV3 = {
  offsetX: 0,
  offsetY: 0,
  scale: 1.0,
  rotationDeg: 0,
  shadowIntensity: 0.6,
};

export interface WatchRenderInputV3 {
  userImage: HTMLImageElement;
  productImage: HTMLImageElement;
  landmarks: TryOnLandmarks | null;
  adjustments?: Partial<WatchAdjustmentsV3>;
}

export type ProductOrientation =
  | "vertical_strap"
  | "horizontal_strap"
  | "square_uncertain";

export interface ProductOrientationResult {
  orientation: ProductOrientation;
  productStrapAxisDeg: number;
  productWidth: number;
  productHeight: number;
  productAspect: number; // height / width
  confidence: number;
}

export interface WatchRenderResultV3 {
  blob: Blob;
  url: string;
  maskBlob: Blob;
  maskUrl: string;
  geometry: WristGeometry;
  rotationDebug: WatchRotationResult;
  orientation: ProductOrientationResult;
  appliedRotationDeg: number;
  rotationQuality: {
    valid: boolean;
    acceptable: boolean;
    diffDeg: number;
    reason: "ok" | "warn" | "fail";
  };
  fromLandmarks: boolean;
  confidence: number;
  edgeQuality: number;
  version: "v3";
}

// ──────────────────────────────────────────────────────────────────────
//  Orientation detection
// ──────────────────────────────────────────────────────────────────────

/**
 * Determine the strap axis of the product image from its alpha
 * bounding box aspect ratio.
 *
 *   - `productAspect = height / width`
 *   - >= 1.15 → vertical_strap (strap 12h–6h, axis = 90°)
 *   - <= 0.87 → horizontal_strap (strap 9h–3h, axis = 0°)
 *   - otherwise → square_uncertain, we DEFAULT to vertical_strap
 *     because that is the dominant case in production catalogues.
 *
 *  The function is intentionally simple — operators can override
 *  the result globally with `PRODUCT_STRAP_AXIS_DEG`.
 */
export function detectWatchProductOrientation(opts: {
  productWidth: number;
  productHeight: number;
}): ProductOrientationResult {
  const w = opts.productWidth || 1;
  const h = opts.productHeight || 1;
  const aspect = h / w;
  let orientation: ProductOrientation = "square_uncertain";
  let productStrapAxisDeg = 90;
  let confidence = 0.5;
  if (aspect >= 1.15) {
    orientation = "vertical_strap";
    productStrapAxisDeg = 90;
    confidence = Math.min(1, 0.6 + (aspect - 1.15) / 2);
  } else if (aspect <= 0.87) {
    orientation = "horizontal_strap";
    productStrapAxisDeg = 0;
    confidence = Math.min(1, 0.6 + (1 / aspect - 1.15) / 2);
  }
  // Env override takes precedence.
  const envRaw =
    typeof process !== "undefined"
      ? process.env.PRODUCT_STRAP_AXIS_DEG?.trim()
      : undefined;
  const envVal = envRaw ? Number(envRaw) : undefined;
  if (typeof envVal === "number" && Number.isFinite(envVal)) {
    productStrapAxisDeg = envVal;
  }
  return {
    orientation,
    productStrapAxisDeg,
    productWidth: w,
    productHeight: h,
    productAspect: aspect,
    confidence,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  Single-layer rotation
// ──────────────────────────────────────────────────────────────────────

/**
 * Rotate the entire product canvas around its centre. Returns a new
 * canvas big enough to contain the rotated PNG without clipping, plus
 * its bounding box in source pixels. No segmentation, no warp — the
 * whole watch (dial + case + strap + logo) is treated as ONE layer.
 *
 *  This is the heart of V3 — every downstream step uses this rotated
 *  canvas as the source of truth.
 */
export function rotateProductLayer(opts: {
  productCanvas: HTMLCanvasElement;
  scale: number;
  rotationDeg: number;
}): {
  canvas: HTMLCanvasElement;
  bbox: { x: number; y: number; width: number; height: number };
  appliedRotationDeg: number;
} {
  const sw = opts.productCanvas.width;
  const sh = opts.productCanvas.height;
  const scaledW = Math.max(1, Math.round(sw * opts.scale));
  const scaledH = Math.max(1, Math.round(sh * opts.scale));

  const rad = (opts.rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const outW = Math.ceil(scaledW * cos + scaledH * sin);
  const outH = Math.ceil(scaledW * sin + scaledH * cos);

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable for rotateProductLayer.");
  }
  ctx.clearRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.drawImage(opts.productCanvas, -scaledW / 2, -scaledH / 2, scaledW, scaledH);

  return {
    canvas: out,
    bbox: { x: 0, y: 0, width: outW, height: outH },
    appliedRotationDeg: opts.rotationDeg,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  Drop shadow — single softened pass under the case
// ──────────────────────────────────────────────────────────────────────

/**
 * Build a soft drop-shadow canvas from a rotated alpha layer. The
 * shadow uses the alpha channel of the source canvas, blurs it, then
 * fills it with semi-transparent black. Offset slightly toward the
 * "down" direction in the rotated frame so the watch reads as
 * sitting on the wrist.
 */
function renderSimpleWatchShadow(opts: {
  rotatedCanvas: HTMLCanvasElement;
  opacity: number;
  blurPx: number;
  offsetXpx: number;
  offsetYpx: number;
}): HTMLCanvasElement {
  const w = opts.rotatedCanvas.width;
  const h = opts.rotatedCanvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  // Use the alpha channel of the source as the shadow shape.
  ctx.save();
  ctx.filter = `blur(${Math.max(0.5, opts.blurPx)}px)`;
  ctx.globalAlpha = Math.max(0, Math.min(1, opts.opacity));
  // Draw the source onto a temp canvas tinted black, then blit into out.
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");
  if (!tctx) return out;
  tctx.drawImage(opts.rotatedCanvas, 0, 0);
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = "rgba(0,0,0,1)";
  tctx.fillRect(0, 0, w, h);
  ctx.drawImage(tmp, opts.offsetXpx, opts.offsetYpx);
  ctx.restore();
  return out;
}

// ──────────────────────────────────────────────────────────────────────
//  Contact band mask (for downstream API consumers that still want one)
// ──────────────────────────────────────────────────────────────────────

function buildContactMaskV3(opts: {
  width: number;
  height: number;
  cx: number;
  cy: number;
  rotatedCanvas: HTMLCanvasElement;
  ringPx: number;
}): HTMLCanvasElement {
  // V3 mask is intentionally minimal — used only for downstream
  // debugging / parity with the v2 API surface. It is NEVER sent
  // back to the API (pipeline strips the mask from the V3 result),
  // so the only consumer is local diagnostics.
  //
  //   - Black background     = preserved.
  //   - White product alpha  = the watch silhouette only.
  //   - NO halo, NO ring     = we never want OpenAI to see this
  //     mask, but if it ever does, it shouldn't include any
  //     finger / palm / background pixel.
  const mask = document.createElement("canvas");
  mask.width = opts.width;
  mask.height = opts.height;
  const mctx = mask.getContext("2d");
  if (!mctx) return mask;
  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, opts.width, opts.height);
  const tmp = document.createElement("canvas");
  tmp.width = opts.width;
  tmp.height = opts.height;
  const tctx = tmp.getContext("2d");
  if (!tctx) return mask;
  tctx.drawImage(
    opts.rotatedCanvas,
    opts.cx - opts.rotatedCanvas.width / 2,
    opts.cy - opts.rotatedCanvas.height / 2
  );
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = "#fff";
  tctx.fillRect(0, 0, opts.width, opts.height);
  mctx.drawImage(tmp, 0, 0);
  return mask;
}

// ──────────────────────────────────────────────────────────────────────
//  Main entry
// ──────────────────────────────────────────────────────────────────────

export async function renderWatchOverlayV3(
  input: WatchRenderInputV3
): Promise<WatchRenderResultV3> {
  const adj: WatchAdjustmentsV3 = {
    ...DEFAULT_WATCH_ADJUSTMENTS_V3,
    ...(input.adjustments ?? {}),
  };
  const userW = input.userImage.naturalWidth || input.userImage.width;
  const userH = input.userImage.naturalHeight || input.userImage.height;

  // 1. Refine product alpha (tight crop, halo removal, defringe).
  const refined = await refineAlphaMask(input.productImage);
  const productAspect = refined.height / refined.width;

  // 2. Orientation detection.
  const orientation = detectWatchProductOrientation({
    productWidth: refined.width,
    productHeight: refined.height,
  });

  // 3. Wrist geometry (anchor + scale).
  const auto = input.landmarks
    ? computeWristGeometry(input.landmarks, productAspect)
    : null;
  const geometry = auto ?? fallbackWristGeometry(userW, userH, productAspect);

  // 4. Rotation — the WHOLE point of V3. We override the productStrap
  //    axis from the orientation detector so a vertical-strap product
  //    rotates around 90° while a horizontal-strap product rotates
  //    around 0°.
  const rotationResult = computeWatchRotation({
    landmarks: input.landmarks,
    imageWidth: userW,
    imageHeight: userH,
    productMeta: { strapAxisDeg: orientation.productStrapAxisDeg },
  });
  let finalRotationDeg = rotationResult.rotationDeg + adj.rotationDeg;

  // Safety: when the forearm is clearly diagonal but the engine
  // estimate is near 0°, force a visible rotation. The check inside
  // computeWatchRotation already runs this when the env flag is on;
  // we re-apply it here in case the user added a manual offset that
  // pulled it back near 0°.
  const forced = forceMinimumRotationForDiagonalForearm({
    forearmAxisDeg: rotationResult.forearmAxisDeg,
    currentRotationDeg: finalRotationDeg,
    thresholdDeg: 15,
    targetDeg: 35,
  });
  if (forced.forced) finalRotationDeg = forced.rotationDeg;
  finalRotationDeg = normalizeAngle180(finalRotationDeg);

  // 5. Apply rotation to the WHOLE product layer (no segmentation).
  // Scale derived from anatomical geometry — V3 favours a smaller
  // watch (target 0.78 × wristWidth).
  const scaleX = geometry.width / refined.width;
  const targetSpanRaw = process.env.WATCH_TARGET_WRIST_RATIO?.trim();
  // 0.72 → slightly smaller than the previous 0.78 default.
  //   - Real watches occupy roughly 60–75 % of the wrist width.
  //   - Smaller dial reads as more realistic and avoids the
  //     "comically oversized prop" look frequently flagged in QA.
  const targetSpan = targetSpanRaw ? Number(targetSpanRaw) : 0.72;
  const wristWidth = geometry.palmWidth * 0.85;
  let v3Scale =
    Math.min(scaleX, (wristWidth * targetSpan) / refined.width) * adj.scale;

  // ── Vertical-strap height cap ───────────────────────────────────
  //   When the product PNG is taller than it is wide (the common
  //   case for catalogue watches shot from above), the rotated
  //   canvas can stretch far above the wrist (over the fingers) and
  //   far below it (into the sleeve), giving a "double watch"
  //   impression where the bracelet looks like a second product.
  //
  //   We cap the rendered HEIGHT to ~2.2× the wrist width so only
  //   a natural amount of strap remains visible on each side of the
  //   dial — the strap fades away anatomically rather than draping
  //   across the entire forearm.
  if (orientation.orientation === "vertical_strap") {
    const maxRenderH = wristWidth * 2.2;
    const heightAtScale = refined.height * v3Scale;
    if (heightAtScale > maxRenderH) {
      v3Scale = (maxRenderH / refined.height) * adj.scale;
    }
  }

  const rotated = rotateProductLayer({
    productCanvas: refined.canvas,
    scale: v3Scale,
    rotationDeg: finalRotationDeg,
  });

  // 6. Drop shadow under the case — two-pass for a grounded feel.
  //    - Soft ambient halo (large blur, low opacity) sits the watch
  //      gently on the skin (perceived light bounce).
  //    - Tight contact shadow (small blur, higher opacity) anchors
  //      the case to the wrist exactly where it would touch.
  const intensity = Math.max(0.1, Math.min(1.5, adj.shadowIntensity / 0.6));
  const ambientShadow = renderSimpleWatchShadow({
    rotatedCanvas: rotated.canvas,
    opacity: 0.18 * intensity,
    blurPx: 22,
    offsetXpx: 0,
    offsetYpx: Math.max(4, Math.round(rotated.canvas.height * 0.05)),
  });
  const contactShadow = renderSimpleWatchShadow({
    rotatedCanvas: rotated.canvas,
    opacity: 0.32 * intensity,
    blurPx: 8,
    offsetXpx: 0,
    offsetYpx: Math.max(2, Math.round(rotated.canvas.height * 0.02)),
  });

  // 7. Composite onto user image.
  const out = document.createElement("canvas");
  out.width = userW;
  out.height = userH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable for V3 render.");
  ctx.drawImage(input.userImage, 0, 0, userW, userH);

  const drawX = geometry.cx + adj.offsetX - rotated.canvas.width / 2;
  const drawY = geometry.cy + adj.offsetY - rotated.canvas.height / 2;
  // Order: ambient halo → tight contact → product. The two-pass
  // shadow makes the watch feel like it is resting on the wrist
  // instead of floating like a sticker.
  ctx.drawImage(ambientShadow, drawX, drawY);
  ctx.drawImage(contactShadow, drawX, drawY);
  ctx.drawImage(rotated.canvas, drawX, drawY);

  // 8. Contact-band mask (white = editable, black = preserved). The
  // mask is intentionally narrow — V3 ships with OpenAI disabled by
  // default for watches but downstream consumers (anti-ghost mux,
  // product-lock) still expect a B/W mask matching the composite.
  const mask = buildContactMaskV3({
    width: userW,
    height: userH,
    cx: geometry.cx + adj.offsetX,
    cy: geometry.cy + adj.offsetY,
    rotatedCanvas: rotated.canvas,
    ringPx: 10,
  });

  // 9. Quality gate on the final rotation.
  const rotationQuality = checkWatchRotationQuality({
    finalRotationDeg,
    forearmAxisDeg: rotationResult.forearmAxisDeg,
    productStrapAxisDeg: orientation.productStrapAxisDeg,
  });

  if (typeof console !== "undefined" && console.info) {
    console.info("[WATCH_ROTATION] v3-render", {
      orientation: orientation.orientation,
      productAspect: Math.round(orientation.productAspect * 100) / 100,
      productStrapAxisDeg: orientation.productStrapAxisDeg,
      forearmAxisDeg: Math.round(rotationResult.forearmAxisDeg * 10) / 10,
      finalRotationDeg: Math.round(finalRotationDeg * 10) / 10,
      appliedRotationDeg: Math.round(rotated.appliedRotationDeg * 10) / 10,
      forcedMinimumApplied: forced.forced,
      axisDiffDeg: Math.round(rotationQuality.diffDeg * 10) / 10,
      qualityReason: rotationQuality.reason,
      v3Scale: Math.round(v3Scale * 1000) / 1000,
      productCoreSource: "rotated_product_layer",
      openAiUsed: false,
    });
  }

  const [blob, maskBlob] = await Promise.all([
    canvasToBlob(out, "image/png"),
    canvasToBlob(mask, "image/png"),
  ]);
  const url = URL.createObjectURL(blob);
  const maskUrl = URL.createObjectURL(maskBlob);

  return {
    blob,
    url,
    maskBlob,
    maskUrl,
    geometry,
    rotationDebug: rotationResult,
    orientation,
    appliedRotationDeg: rotated.appliedRotationDeg,
    rotationQuality: {
      valid: rotationQuality.valid,
      acceptable: rotationQuality.acceptable,
      diffDeg: rotationQuality.diffDeg,
      reason: rotationQuality.reason,
    },
    fromLandmarks: auto !== null && geometry.confidence > 0.1,
    confidence: geometry.confidence,
    edgeQuality: refined.edgeQuality,
    version: "v3",
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob returned null"));
      },
      mime,
      0.95
    );
  });
}

// ──────────────────────────────────────────────────────────────────────
//  Env detection
// ──────────────────────────────────────────────────────────────────────

/**
 * Read `WATCH_RENDERER_VERSION` from env. Defaults to `v3` — the
 * orientation-aware single-layer pipeline. Set to `v2` to fall back
 * to the legacy three-segment renderer (useful for A/B tests).
 *
 *  We support BOTH NEXT_PUBLIC_ and bare names so the value is
 *  available in both the browser and the server (the renderer runs
 *  client-side).
 */
export function getWatchRendererVersion(): "v2" | "v3" {
  const raw =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_WATCH_RENDERER_VERSION ??
          process.env.WATCH_RENDERER_VERSION ??
          "v3")
      : "v3";
  const v = raw.trim().toLowerCase();
  return v === "v2" ? "v2" : "v3";
}
