"use client";

/**
 * Build realistic two-layer shadows from a warped product silhouette.
 *
 *  Layer 1 — soft ambient :
 *    Wide blur (10–16 px on a typical 1000-px-wide image), low opacity,
 *    slight downward offset. Creates a general "the object is hovering
 *    just above the skin" cue.
 *
 *  Layer 2 — contact :
 *    Tight blur (2–5 px), higher opacity, applied with a vertical mask so
 *    only the lower half of the silhouette gets the dark contact line.
 *
 *  We never paint a rectangle — both shadows respect the alpha mask of the
 *  warped product canvas, so a transparent cutout produces a transparent
 *  shadow boundary.
 */

export interface ShadowOptions {
  /** Total width of the warped product canvas (px). */
  width: number;
  /** Total height of the warped product canvas (px). */
  height: number;
  /** Ambient shadow blur radius in pixels. Default scales with width. */
  ambientBlur?: number;
  /** Contact shadow blur radius in pixels. Default scales with width. */
  contactBlur?: number;
  /** Ambient shadow opacity in [0..1]. Default 0.22. */
  ambientOpacity?: number;
  /** Contact shadow opacity in [0..1]. Default 0.30. */
  contactOpacity?: number;
  /** Vertical offset of the ambient shadow, in pixels. */
  ambientOffsetY?: number;
}

export interface ShadowLayers {
  ambient: HTMLCanvasElement;
  contact: HTMLCanvasElement;
}

/**
 * Build the ambient + contact shadow canvases from a warped product
 * silhouette. Both canvases have the same dimensions as `product`.
 */
export function buildShadowLayers(
  product: HTMLCanvasElement,
  opts: ShadowOptions
): ShadowLayers {
  const W = opts.width;
  const H = opts.height;
  const ambientBlur = opts.ambientBlur ?? Math.max(8, Math.round(W * 0.012));
  const contactBlur = opts.contactBlur ?? Math.max(2, Math.round(W * 0.003));
  const ambientOpacity = opts.ambientOpacity ?? 0.22;
  const contactOpacity = opts.contactOpacity ?? 0.3;
  const ambientOffsetY = opts.ambientOffsetY ?? Math.round(H * 0.03);

  return {
    ambient: buildAmbient(
      product,
      W,
      H,
      ambientBlur,
      ambientOpacity,
      ambientOffsetY
    ),
    contact: buildContact(product, W, H, contactBlur, contactOpacity),
  };
}

/**
 * Soft ambient shadow: silhouette → blur → tint → opacity.
 */
function buildAmbient(
  product: HTMLCanvasElement,
  W: number,
  H: number,
  blur: number,
  opacity: number,
  offsetY: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, W, H);

  // 1. Stamp the product silhouette tinted in black, blurred via the canvas
  //    shadow API. The product itself is *not* drawn — only its blurred
  //    shadow projection — by using an off-canvas origin combined with
  //    shadowOffsetX/Y back into the visible area.
  ctx.save();
  ctx.shadowColor = `rgba(0, 0, 0, ${opacity})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = W * 2; // pushes the product itself off-canvas
  ctx.shadowOffsetY = offsetY;
  ctx.drawImage(product, -W * 2, 0, W, H);
  ctx.restore();

  return canvas;
}

/**
 * Contact shadow: a tighter shadow restricted to the lower half of the
 * silhouette so only the bottom edge "grounds" on the skin.
 */
function buildContact(
  product: HTMLCanvasElement,
  W: number,
  H: number,
  blur: number,
  opacity: number
): HTMLCanvasElement {
  // 1. Render the full blurred silhouette into a scratch canvas.
  const scratch = document.createElement("canvas");
  scratch.width = W;
  scratch.height = H;
  const sctx = scratch.getContext("2d");
  if (!sctx) return scratch;
  sctx.clearRect(0, 0, W, H);

  sctx.save();
  sctx.shadowColor = `rgba(0, 0, 0, ${opacity})`;
  sctx.shadowBlur = blur;
  sctx.shadowOffsetX = W * 2;
  sctx.shadowOffsetY = Math.max(1, Math.round(H * 0.012));
  sctx.drawImage(product, -W * 2, 0, W, H);
  sctx.restore();

  // 2. Mask out the upper half with a vertical gradient so only the lower
  //    edge keeps the contact darkness.
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  if (!octx) return scratch;
  octx.clearRect(0, 0, W, H);

  octx.drawImage(scratch, 0, 0);
  octx.globalCompositeOperation = "destination-in";
  const grad = octx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.45, "rgba(0,0,0,0)");
  grad.addColorStop(0.7, "rgba(0,0,0,0.6)");
  grad.addColorStop(1, "rgba(0,0,0,1)");
  octx.fillStyle = grad;
  octx.fillRect(0, 0, W, H);
  octx.globalCompositeOperation = "source-over";

  return out;
}
