/**
 * Pure placement math for each category. No DOM, no AI calls.
 *
 *  Outputs are pixel coordinates in the *full-resolution* user image.
 *
 *  Conventions:
 *  - All MediaPipe landmarks are normalized [0..1]. We multiply by image
 *    dimensions to convert to pixels.
 *  - `rotation` is in radians and applied CCW around (cx, cy).
 */

import type {
  FingerId,
  HandJewelryType,
  LandmarkPoint,
  Placement,
  TryOnLandmarks,
} from "./types";
import { FINGER_LANDMARKS, HAND_LANDMARK_WRIST } from "./types";

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

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function angleBetween(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// ──────────────────────────────────────────────────────────────────────────
//  GLASSES
// ──────────────────────────────────────────────────────────────────────────

/**
 * MediaPipe FaceLandmarker (478 points) eye corners:
 *   - Right eye outer corner : 33
 *   - Right eye inner corner : 133
 *   - Left  eye inner corner : 362
 *   - Left  eye outer corner : 263
 *   - Nose bridge top        : 168
 */
const FACE = {
  rightEyeOuter: 33,
  rightEyeInner: 133,
  leftEyeInner: 362,
  leftEyeOuter: 263,
  noseBridge: 168,
  forehead: 10,
  chin: 152,
  rightTemple: 234,
  leftTemple: 454,
} as const;

export function computeGlassesPlacement(
  lm: TryOnLandmarks
): Placement | null {
  const face = lm.face;
  if (!face || face.length < 478) return null;
  const W = lm.imageWidth;
  const H = lm.imageHeight;

  const rOuter = px(face[FACE.rightEyeOuter], W, H);
  const lOuter = px(face[FACE.leftEyeOuter], W, H);
  const nose = px(face[FACE.noseBridge], W, H);
  const rTemple = px(face[FACE.rightTemple], W, H);
  const lTemple = px(face[FACE.leftTemple], W, H);

  const eyeSpan = dist(rOuter, lOuter);
  const templeSpan = dist(rTemple, lTemple);
  // Glasses frame typically spans ~1.05x the outer-eye distance and ~0.9x
  // of the temple-to-temple distance.
  const width = Math.max(eyeSpan * 1.55, templeSpan * 0.92);
  const height = width * 0.42; // typical aspect ratio for frames

  return {
    cx: nose.x,
    cy: midpoint(rOuter, lOuter).y, // align vertically with eye line
    width,
    height,
    rotation: angleBetween(rOuter, lOuter),
    shadow: 0.25,
    anchor: "eye-line",
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  HEADWEAR
// ──────────────────────────────────────────────────────────────────────────

export function computeHeadwearPlacement(
  lm: TryOnLandmarks
): Placement | null {
  const face = lm.face;
  if (!face || face.length < 478) return null;
  const W = lm.imageWidth;
  const H = lm.imageHeight;

  const forehead = px(face[FACE.forehead], W, H);
  const chin = px(face[FACE.chin], W, H);
  const rTemple = px(face[FACE.rightTemple], W, H);
  const lTemple = px(face[FACE.leftTemple], W, H);

  const headWidth = dist(rTemple, lTemple) * 1.12;
  const faceHeight = dist(forehead, chin);
  // Sit the hat with its bottom edge slightly above the forehead.
  const cap = {
    x: midpoint(rTemple, lTemple).x,
    y: forehead.y - faceHeight * 0.18,
  };
  const headHeight = headWidth * 0.85;

  return {
    cx: cap.x,
    cy: cap.y,
    width: headWidth,
    height: headHeight,
    rotation: angleBetween(rTemple, lTemple),
    shadow: 0.3,
    anchor: "forehead",
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  WATCH
// ──────────────────────────────────────────────────────────────────────────

/**
 * MediaPipe HandLandmarker (21 points):
 *   0  : wrist
 *   1  : thumb CMC (base of thumb on the wrist)
 *   5  : index MCP
 *   17 : pinky MCP
 *
 * The wrist axis is the segment from `wrist` perpendicular to
 * `index_mcp - pinky_mcp`. Watch should be slightly above the wrist
 * landmark, along the forearm.
 */
export function computeWatchPlacement(
  lm: TryOnLandmarks
): Placement | null {
  const hand = lm.hand;
  if (!hand || hand.length < 21) return null;
  const W = lm.imageWidth;
  const H = lm.imageHeight;

  const wrist = px(hand[HAND_LANDMARK_WRIST], W, H);
  const indexMcp = px(hand[5], W, H);
  const pinkyMcp = px(hand[17], W, H);
  const middleMcp = px(hand[9], W, H);

  // Hand width across knuckles → wrist width estimate (anatomically ~0.85x).
  const knuckleSpan = dist(indexMcp, pinkyMcp);
  const wristWidth = knuckleSpan * 0.95;

  // Forearm direction = from middle-finger MCP toward the wrist.
  const forearmDx = wrist.x - middleMcp.x;
  const forearmDy = wrist.y - middleMcp.y;
  const forearmLen = Math.hypot(forearmDx, forearmDy) || 1;
  const ux = forearmDx / forearmLen;
  const uy = forearmDy / forearmLen;

  // Watch center: ~25% past the wrist landmark down the forearm.
  const offset = knuckleSpan * 0.4;
  const cx = wrist.x + ux * offset;
  const cy = wrist.y + uy * offset;

  // Watch case typically ~1.05x wrist width, height ~0.7x its width.
  const width = wristWidth * 1.05;
  const height = width * 0.7;

  // Rotation of the watch = perpendicular to the forearm axis.
  const rotation = Math.atan2(uy, ux) + Math.PI / 2;

  return {
    cx,
    cy,
    width,
    height,
    rotation,
    shadow: 0.4,
    anchor: "wrist-axis",
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  RING (single finger)
// ──────────────────────────────────────────────────────────────────────────

export function computeRingPlacement(
  lm: TryOnLandmarks,
  finger: FingerId
): Placement | null {
  const hand = lm.hand;
  if (!hand || hand.length < 21) return null;
  const W = lm.imageWidth;
  const H = lm.imageHeight;

  const ids = FINGER_LANDMARKS[finger];
  const mcp = px(hand[ids.mcp], W, H);
  const pip = px(hand[ids.pip], W, H);

  // Estimate finger width from the distance between this finger's MCP and
  // its neighbor's MCP. For pinky, use ring MCP as neighbor.
  const neighborMcpId =
    finger === "pinky"
      ? FINGER_LANDMARKS.ring.mcp
      : finger === "index"
        ? FINGER_LANDMARKS.middle.mcp
        : finger === "middle"
          ? FINGER_LANDMARKS.index.mcp
          : FINGER_LANDMARKS.middle.mcp;
  const neighborMcp = px(hand[neighborMcpId], W, H);
  const fingerWidth = Math.max(8, dist(mcp, neighborMcp) * 0.72);

  // Ring sits between the MCP and PIP joint, slightly closer to PIP.
  const t = 0.55;
  const cx = mcp.x + (pip.x - mcp.x) * t;
  const cy = mcp.y + (pip.y - mcp.y) * t;

  const rotation = angleBetween(mcp, pip) + Math.PI / 2;

  // Ring width = finger width; height = a bit shorter (band thickness).
  const width = fingerWidth * 1.05;
  const height = fingerWidth * 0.85;

  return {
    cx,
    cy,
    width,
    height,
    rotation,
    shadow: 0.35,
    anchor: `finger:${finger}`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  BRACELET
// ──────────────────────────────────────────────────────────────────────────

export function computeBraceletPlacement(
  lm: TryOnLandmarks
): Placement | null {
  // Bracelet placement uses the same anchor logic as the watch — wrist axis,
  // perpendicular orientation — but the product is typically thinner.
  const base = computeWatchPlacement(lm);
  if (!base) return null;
  return {
    ...base,
    height: base.height * 0.55,
    anchor: "wrist-axis-bracelet",
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  ENTRY POINT
// ──────────────────────────────────────────────────────────────────────────

export function computePlacement(
  lm: TryOnLandmarks,
  opts: { handJewelryType?: HandJewelryType; ringFinger?: FingerId }
): Placement | null {
  switch (lm.category) {
    case "glasses":
      return computeGlassesPlacement(lm);
    case "headwear":
      return computeHeadwearPlacement(lm);
    case "watch":
      return computeWatchPlacement(lm);
    case "hand-jewelry": {
      const subtype = opts.handJewelryType ?? "ring";
      if (subtype === "bracelet") {
        return computeBraceletPlacement(lm);
      }
      return computeRingPlacement(lm, opts.ringFinger ?? "ring");
    }
    case "clothes":
      // Clothes are not done deterministically — they require a dedicated
      // VTON model (FASHN). The pipeline routes around this.
      return null;
    default:
      return null;
  }
}
