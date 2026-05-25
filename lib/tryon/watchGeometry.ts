/**
 * Watch-specific wrist geometry.
 *
 * Builds a target quadrilateral around the wrist using MediaPipe hand
 * landmarks. The dial sits along the wrist axis (perpendicular to the
 * forearm) and the strap extends to either side, tapered to wrap around
 * the wrist when drawn.
 *
 * Landmarks used:
 *   0  : wrist
 *   1  : thumb CMC
 *   5  : index MCP
 *   9  : middle MCP
 *   13 : ring MCP
 *   17 : pinky MCP
 */

import type { LandmarkPoint, TryOnLandmarks } from "./types";

export interface WristGeometry {
  /** Center of the watch on the user image (pixels). */
  cx: number;
  cy: number;
  /** Width of the watch dial+strap span (pixels). */
  width: number;
  /** Height of the watch case (pixels). Derived from product aspect ratio. */
  height: number;
  /** Rotation in radians around (cx, cy), aligned with the wrist axis. */
  rotation: number;
  /** Estimated palm/knuckle span — useful for further scaling. */
  palmWidth: number;
  /** Wrist axis unit vector (perpendicular to forearm, pointing left/right). */
  axis: { x: number; y: number };
  /** Forearm direction unit vector (knuckles → wrist → elbow). */
  forearm: { x: number; y: number };
  /** Detection confidence in [0..1]. */
  confidence: number;
}

interface Vec2 {
  x: number;
  y: number;
}

function px(p: LandmarkPoint, w: number, h: number): Vec2 {
  return { x: p.x * w, y: p.y * h };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

/**
 * Compute wrist geometry from MediaPipe hand landmarks.
 *
 *  - watchCenter = wrist - handDirection * palmWidth * 0.28
 *    (i.e. slightly behind the wrist, along the forearm)
 *  - watchWidth  = palmWidth * 0.95
 *  - rotation   = atan2(wristAxis.y, wristAxis.x)
 *
 *  productAspect is height / width of the (alpha-trimmed) watch image.
 */
export function computeWristGeometry(
  lm: TryOnLandmarks,
  productAspect: number
): WristGeometry | null {
  const hand = lm.hand;
  if (!hand || hand.length < 21) return null;
  const W = lm.imageWidth;
  const H = lm.imageHeight;

  const wrist = px(hand[0], W, H);
  const indexMcp = px(hand[5], W, H);
  const middleMcp = px(hand[9], W, H);
  const ringMcp = px(hand[13], W, H);
  const pinkyMcp = px(hand[17], W, H);

  // palmCenter = average(indexMcp, middleMcp, ringMcp, pinkyMcp)
  const palmCenter: Vec2 = {
    x: (indexMcp.x + middleMcp.x + ringMcp.x + pinkyMcp.x) / 4,
    y: (indexMcp.y + middleMcp.y + ringMcp.y + pinkyMcp.y) / 4,
  };

  // handDirection = normalize(palmCenter - wrist)
  const handDir = normalize({
    x: palmCenter.x - wrist.x,
    y: palmCenter.y - wrist.y,
  });

  // forearm = -handDir (from palm toward wrist/elbow)
  const forearm: Vec2 = { x: -handDir.x, y: -handDir.y };

  // wristAxis = perpendicular(handDirection)
  const axis: Vec2 = { x: -handDir.y, y: handDir.x };

  // palmWidth = distance(indexMcp, pinkyMcp)
  const palmWidth = dist(indexMcp, pinkyMcp);

  // watchCenter = wrist - handDir * palmWidth * 0.32
  // (slightly further along the forearm than v1 so the dial sits clear of
  //  the wrist crease)
  const cx = wrist.x - handDir.x * palmWidth * 0.32;
  const cy = wrist.y - handDir.y * palmWidth * 0.32;

  // watchWidth = palmWidth * 1.15 (was 0.95). Most watches read too small
  // with a strict palmWidth proxy because the strap extends well past the
  // wrist width on either side.
  const width = palmWidth * 1.15;
  const height = width * productAspect;

  // rotation aligns the watch's horizontal axis with wristAxis.
  const rotation = Math.atan2(axis.y, axis.x);

  // Confidence: visibility of the 4 key landmarks (if MediaPipe gave us any)
  // combined with the geometric sanity of the palm size.
  const visAvg = avgVisibility(hand, [0, 5, 9, 13, 17]);
  const sizeFactor = Math.min(1, palmWidth / (Math.min(W, H) * 0.06));
  const confidence = Math.max(0, Math.min(1, visAvg * 0.6 + sizeFactor * 0.4));

  return {
    cx,
    cy,
    width,
    height,
    rotation,
    palmWidth,
    axis,
    forearm,
    confidence,
  };
}

function avgVisibility(hand: LandmarkPoint[], idx: number[]): number {
  let sum = 0;
  let count = 0;
  for (const i of idx) {
    const v = hand[i]?.visibility;
    if (typeof v === "number") {
      sum += v;
      count++;
    }
  }
  if (count === 0) return 0.85; // MediaPipe rarely emits visibility on hand — assume OK
  return sum / count;
}

/** Default centred geometry used when landmark detection failed. */
export function fallbackWristGeometry(
  imageWidth: number,
  imageHeight: number,
  productAspect: number
): WristGeometry {
  const width = imageWidth * 0.45;
  return {
    cx: imageWidth * 0.5,
    cy: imageHeight * 0.55,
    width,
    height: width * productAspect,
    rotation: 0,
    palmWidth: width,
    axis: { x: 1, y: 0 },
    forearm: { x: 0, y: 1 },
    confidence: 0,
  };
}
