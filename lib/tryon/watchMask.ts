"use client";

/**
 * Watch contact-band mask builder.
 *
 *  Why a *band* and not a *full silhouette*?
 *  ────────────────────────────────────────
 *  FLUX.1 [pro] Fill (and any decent inpainting model) replaces masked pixels
 *  while keeping unmasked pixels mathematically intact. If we mask the whole
 *  watch in white, the AI will re-imagine the dial — that's where logos,
 *  hands, indices and brand names get hallucinated.
 *
 *  Instead, we paint white **only along the contour** of the watch:
 *
 *      ┌────────────────────────────┐
 *      │    [skin / clothing]       │   ← black (preserved)
 *      │   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄     │   ← white band (AI repaints
 *      │   █                  █     │     this 8–14 px ring →
 *      │   █     [DIAL]       █     │     contact shadows + soft
 *      │   █  (preserved)     █     │     skin blend)
 *      │   █                  █     │
 *      │   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀     │   ← black (preserved)
 *      │    [skin / clothing]       │
 *      └────────────────────────────┘
 *
 *  Implementation: take the warped watch silhouette canvas, blur it heavily,
 *  then threshold the grayscale into three bands:
 *    - alpha ≥ 0.78 (deep inside)  → black (preserve)
 *    - alpha ∈ [0.14, 0.78] (band) → white (paint)
 *    - alpha <  0.14 (far outside) → black (preserve)
 *
 *  This produces a ~8–16 px ring straddling the watch silhouette boundary,
 *  which is exactly the zone where realistic contact shadow + skin blending
 *  should appear.
 */

export interface ContactMaskOptions {
  /** Output canvas width (must match composite width). */
  width: number;
  /** Output canvas height (must match composite height). */
  height: number;
  /** Position of the silhouette canvas centre on the output. */
  centerX: number;
  centerY: number;
  /** Rotation in radians, applied around (centerX, centerY). */
  rotation: number;
  /** Source silhouette canvas (alpha = silhouette). */
  silhouette: HTMLCanvasElement;
  /**
   * Blur radius used to feather the silhouette before thresholding.
   * Higher → wider band. Default 10.
   */
  blurPx?: number;
  /**
   * Optional extra-band underneath the watch to extend the contact shadow
   * onto the skin. Useful for chunky watches where the contour ring isn't
   * enough. Set 0 to disable. Default 0.
   */
  groundedShadowPx?: number;
}

export interface ContactMaskResult {
  /** PNG blob, full image size, black + white. */
  blob: Blob;
  /** Object URL — caller is responsible for revoking. */
  url: string;
  /** Width of the white band area in pixels (diagnostic). */
  approxBandPx: number;
}

const DEFAULT_BLUR = 10;
const INNER_THRESHOLD = 0.78; // grayscale (0..1) — above this is "deep inside"
const OUTER_THRESHOLD = 0.14; // below this is "far outside"

export async function buildContactMask(
  opts: ContactMaskOptions
): Promise<ContactMaskResult> {
  const W = Math.max(1, Math.round(opts.width));
  const H = Math.max(1, Math.round(opts.height));
  const blur = opts.blurPx ?? DEFAULT_BLUR;

  // 1. Render the silhouette at its real position/rotation onto a black canvas
  //    of the composite's dimensions.
  const stage = document.createElement("canvas");
  stage.width = W;
  stage.height = H;
  const sctx = stage.getContext("2d");
  if (!sctx) throw new Error("Canvas 2D context unavailable for mask stage.");
  sctx.fillStyle = "#000";
  sctx.fillRect(0, 0, W, H);

  sctx.save();
  sctx.translate(opts.centerX, opts.centerY);
  sctx.rotate(opts.rotation);
  const drawX = -opts.silhouette.width / 2;
  const drawY = -opts.silhouette.height / 2;
  // We don't want the silhouette's RGB — we only want its alpha as a
  // grayscale mask. Draw it onto a temporary white canvas first to convert
  // alpha → luminance.
  const tmp = document.createElement("canvas");
  tmp.width = opts.silhouette.width;
  tmp.height = opts.silhouette.height;
  const tctx = tmp.getContext("2d");
  if (!tctx) throw new Error("Canvas 2D context unavailable for tmp.");
  tctx.fillStyle = "#000";
  tctx.fillRect(0, 0, tmp.width, tmp.height);
  // Draw silhouette pixels as white wherever they have alpha.
  tctx.globalCompositeOperation = "source-over";
  tctx.drawImage(opts.silhouette, 0, 0);
  // Replace any non-transparent colour with pure white using source-in.
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = "#fff";
  tctx.fillRect(0, 0, tmp.width, tmp.height);
  tctx.globalCompositeOperation = "source-over";

  sctx.drawImage(tmp, drawX, drawY);
  sctx.restore();

  // 2. Heavy blur to spread the silhouette into a feathered grayscale ramp.
  const blurred = document.createElement("canvas");
  blurred.width = W;
  blurred.height = H;
  const bctx = blurred.getContext("2d");
  if (!bctx) throw new Error("Canvas 2D context unavailable for blur.");
  bctx.fillStyle = "#000";
  bctx.fillRect(0, 0, W, H);
  bctx.filter = `blur(${blur}px)`;
  bctx.drawImage(stage, 0, 0);
  bctx.filter = "none";

  // 3. Threshold the blurred grayscale into a 3-band mask:
  //       deep inside  → black (preserve dial)
  //       contour band → white (AI repaints)
  //       far outside  → black (preserve skin / clothing)
  const img = bctx.getImageData(0, 0, W, H);
  const data = img.data;
  let bandCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    // R==G==B because the blurred source is grayscale, so any channel works.
    let v = 0;
    if (r > OUTER_THRESHOLD && r < INNER_THRESHOLD) {
      v = 255;
      bandCount++;
    }
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);

  // 4. Optionally add a soft grounded patch below the watch for contact
  //    shadow on skin (chunky watches benefit from this).
  if (opts.groundedShadowPx && opts.groundedShadowPx > 0) {
    const patch = document.createElement("canvas");
    patch.width = W;
    patch.height = H;
    const pctx = patch.getContext("2d");
    if (pctx) {
      pctx.save();
      pctx.translate(opts.centerX, opts.centerY);
      pctx.rotate(opts.rotation);
      pctx.fillStyle = "#fff";
      pctx.filter = `blur(${opts.groundedShadowPx}px)`;
      const w = opts.silhouette.width * 0.92;
      const h = Math.max(8, opts.silhouette.height * 0.22);
      pctx.fillRect(-w / 2, opts.silhouette.height / 2 - h * 0.4, w, h);
      pctx.filter = "none";
      pctx.restore();
      bctx.globalCompositeOperation = "lighten";
      bctx.drawImage(patch, 0, 0);
      bctx.globalCompositeOperation = "source-over";
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    blurred.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Mask export failed."))),
      "image/png"
    );
  });
  const url = URL.createObjectURL(blob);
  return { blob, url, approxBandPx: bandCount };
}
