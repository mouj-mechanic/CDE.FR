"use client";

/**
 * Watch inpainting mask builder.
 *
 *  Output:  a black-and-white PNG aligned 1:1 with the composite image.
 *           - Pure white (255)  → "the AI may fully repaint these pixels".
 *           - Mid grey            → "the AI applies *partial* repainting".
 *           - Pure black (0)    → "the AI must preserve these pixels".
 *
 *  Strategy ─ feathered full silhouette + grounded shadow patch:
 *
 *      1. Draw the full warped watch silhouette in pure white onto a black
 *         canvas at the right position + rotation. (This is the entire
 *         watch, dial included.)
 *      2. Apply a Gaussian blur of ~15–18 px so the white silhouette
 *         bleeds 15–20 px outward into the black background.
 *      3. Optionally add a small soft white patch under the watch to
 *         widen the contact-shadow area on the wrist skin.
 *
 *      Result: pixels deep inside the watch  → 1.0 (pure white)
 *              pixels along the contour     → 0.4–0.95 (smooth ramp)
 *              pixels 20 px away on the skin → 0.0 (preserved)
 *
 *  Why this beats a hard mask:
 *      Modern inpainting models (FLUX Fill, SDXL inpainting, FLUX LoRA
 *      inpainting) treat *grey* values as a per-pixel scaling of the
 *      denoise strength. A grey ramp around the silhouette therefore
 *      tells the model: "blend this transition zone smoothly".
 *      That is exactly the regime where ambient-occlusion shadows form
 *      under the strap — without the model needing to invent geometry.
 *
 *  Why combined with a low global `strength` (≈ 0.28):
 *      strength=1.0 + soft mask = the dial gets fully redrawn anyway.
 *      strength=0.28 + soft mask = the dial only gets ~28 % denoise →
 *      logos, indices, hands and sub-dials remain mathematically close
 *      to the input pixel values, while the soft contour ramp lets the
 *      model paint full ambient-occlusion shadows on the skin.
 *      (Note: `fal-ai/flux-pro/v1/fill` does not accept `strength`. On
 *      that endpoint the soft mask alone provides the AO blend; if dial
 *      preservation becomes an issue, route to `flux-lora/inpainting`
 *      where the `strength` parameter is honoured.)
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
   * Gaussian feather radius in pixels. The white silhouette will bleed
   * roughly this many pixels outward into the black background, giving
   * the AI room to paint contact shadows on the skin. Default 16.
   */
  featherPx?: number;
  /**
   * Width (in px) of an additional soft white patch under the watch to
   * extend the contact-shadow zone onto the wrist. Set 0 to disable.
   * Default ≈ 18 % of the silhouette height.
   */
  groundedShadowPx?: number;
}

export interface ContactMaskResult {
  /** PNG blob, full image size, black + white + grey ramp. */
  blob: Blob;
  /** Object URL — caller is responsible for revoking. */
  url: string;
  /** Approximate count of pixels with mask value ≥ 25 (diagnostic). */
  approxBandPx: number;
}

const DEFAULT_FEATHER = 16;

export async function buildContactMask(
  opts: ContactMaskOptions
): Promise<ContactMaskResult> {
  const W = Math.max(1, Math.round(opts.width));
  const H = Math.max(1, Math.round(opts.height));
  const feather = opts.featherPx ?? DEFAULT_FEATHER;

  // 1. Render the silhouette → pure white on a black canvas at the right
  //    position/rotation. We don't want the silhouette's RGB; we only want
  //    its alpha as a binary stencil.
  const stage = document.createElement("canvas");
  stage.width = W;
  stage.height = H;
  const sctx = stage.getContext("2d");
  if (!sctx) throw new Error("Canvas 2D context unavailable for mask stage.");
  sctx.fillStyle = "#000";
  sctx.fillRect(0, 0, W, H);

  // First, convert the silhouette canvas to a tight white-on-transparent
  // sprite so we can position it anywhere without dragging RGB pixels.
  const sprite = document.createElement("canvas");
  sprite.width = opts.silhouette.width;
  sprite.height = opts.silhouette.height;
  const tctx = sprite.getContext("2d");
  if (!tctx) throw new Error("Canvas 2D context unavailable for tmp.");
  tctx.drawImage(opts.silhouette, 0, 0);
  // Replace RGB with pure white wherever alpha is non-zero.
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = "#fff";
  tctx.fillRect(0, 0, sprite.width, sprite.height);
  tctx.globalCompositeOperation = "source-over";

  // 2. Draw the white sprite onto the stage at the rotated position.
  sctx.save();
  sctx.translate(opts.centerX, opts.centerY);
  sctx.rotate(opts.rotation);
  sctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
  sctx.restore();

  // 3. Optionally add a soft grounded patch below the watch to extend the
  //    contact-shadow area onto the wrist. This patch is added *before*
  //    the blur so its edges naturally feather into the final mask.
  const groundedPx =
    opts.groundedShadowPx ?? Math.round(opts.silhouette.height * 0.18);
  if (groundedPx > 0) {
    sctx.save();
    sctx.translate(opts.centerX, opts.centerY);
    sctx.rotate(opts.rotation);
    sctx.fillStyle = "#fff";
    const w = opts.silhouette.width * 0.92;
    const h = Math.max(8, opts.silhouette.height * 0.22);
    sctx.fillRect(-w / 2, opts.silhouette.height / 2 - h * 0.4, w, h);
    sctx.restore();
  }

  // 4. Apply a Gaussian blur via canvas.filter so the white silhouette
  //    bleeds outward into the black background. We render onto a fresh
  //    canvas because applying `filter` to the same canvas requires a
  //    redraw.
  const blurred = document.createElement("canvas");
  blurred.width = W;
  blurred.height = H;
  const bctx = blurred.getContext("2d");
  if (!bctx) throw new Error("Canvas 2D context unavailable for blur.");
  bctx.fillStyle = "#000";
  bctx.fillRect(0, 0, W, H);
  bctx.filter = `blur(${feather}px)`;
  bctx.drawImage(stage, 0, 0);
  bctx.filter = "none";

  // 5. Force the result back into a strictly grayscale RGB so models that
  //    expect a single-channel-style mask read identical R==G==B values
  //    everywhere. (Some endpoints look at the red channel only.) This
  //    also clamps any minor off-grey artefacts from the blur.
  const img = bctx.getImageData(0, 0, W, H);
  const data = img.data;
  let bandCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Re-compute luminance just to be safe; the input is already
    // grayscale because we only painted black + white.
    const v = data[i];
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
    if (v >= 25) bandCount++;
  }
  bctx.putImageData(img, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    blurred.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Mask export failed."))),
      "image/png"
    );
  });
  const url = URL.createObjectURL(blob);
  return { blob, url, approxBandPx: bandCount };
}
