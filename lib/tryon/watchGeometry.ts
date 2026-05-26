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
import {
  computeWatchRotation,
  type WatchRotationResult,
} from "./watchRotation";
import { computeWristPlane, type WristPlaneResult } from "./wristPlane";

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
  /**
   * Anchor point on the user's wrist landmark (pre-offset). Useful for
   * the target-band validation in `validateWatchPlacement`.
   */
  wristAnchor: { x: number; y: number };
  /**
   * Optional detailed rotation diagnostics. Populated by the unified
   * rotation engine (see `lib/tryon/watchRotation.ts`) — present when
   * `computeWristGeometry` succeeded, undefined on the fallback path.
   */
  rotationDebug?: WatchRotationResult;
  /**
   * Lightweight 3D wrist plane estimate (pitch, yaw, foreshortening).
   * See `lib/tryon/wristPlane.ts`. Drives the perspective skew applied
   * in `renderWatchOverlay` so the watch wraps around the wrist
   * instead of sitting on it like a sticker.
   */
  wristPlane?: WristPlaneResult;
}

/**
 * Validate a watch placement against the anatomic wrist band:
 *
 *   - The watch centre should sit between 0.2 and 0.5 × palmWidth
 *     from the wrist landmark, along the forearm direction (toward
 *     the elbow). Anything closer puts the watch on the wrist crease
 *     or the back of the hand; anything further puts it mid-forearm.
 *
 *   - The watch centre's lateral distance from the forearm axis must
 *     stay within 0.25 × palmWidth so the watch doesn't drift off the
 *     forearm sideways.
 *
 *   - The watch span must stay within 0.75–1.25 × wristWidth, where
 *     wristWidth ≈ 0.85 × palmWidth.
 */
export interface WatchPlacementValidation {
  /** True when the centre is inside the target wrist band. */
  centreInBand: boolean;
  /** True when the size is within the allowed range. */
  sizeInRange: boolean;
  /** Distance along the forearm axis from the wrist landmark (pixels). */
  forearmOffset: number;
  /** Perpendicular distance from the forearm axis (pixels). */
  lateralOffset: number;
  /** watchWidth / wristWidth. */
  sizeRatio: number;
  /**
   * Corrected geometry that satisfies every rule. When the input is
   * already valid, this is the input unchanged.
   */
  corrected: WristGeometry;
  /** Human-readable reason when one of the booleans is false. */
  notes: string[];
}

// Tightened production thresholds (anatomical pass, June 2026).
//
//   - Target band: 0.08..0.24 × palmWidth (centre 0.15). The watch
//     is now placed close to the wrist landmark itself (which sits
//     on the styloid process of the ulna — the anatomically
//     correct spot for a wristwatch). The old band (0.26 default,
//     0.34 max) placed the watch mid-forearm; the new band keeps
//     it on the wrist crease.
//   - Lateral: 0.18 × palmWidth max — the watch stays tightly
//     centred over the forearm axis. Lowered from 0.20.
//   - Size: 0.72..0.98 × wristWidth, hard target 0.86. Unchanged.
const TARGET_MIN_FORE = 0.08;
const TARGET_MAX_FORE = 0.24;
const TARGET_MAX_LATERAL = 0.18;
const TARGET_MIN_SIZE = 0.72;
const TARGET_MAX_SIZE = 0.98;

export function validateWatchPlacement(
  g: WristGeometry
): WatchPlacementValidation {
  const notes: string[] = [];
  const forearm = g.forearm;
  // Vector from wrist anchor to watch centre.
  const dx = g.cx - g.wristAnchor.x;
  const dy = g.cy - g.wristAnchor.y;
  // Projection onto forearm axis (signed). Positive = toward elbow.
  const forearmOffsetPx = dx * forearm.x + dy * forearm.y;
  // Perpendicular component magnitude.
  const lateralPx = Math.abs(dx * -forearm.y + dy * forearm.x);

  const palmW = g.palmWidth || 1;
  const wristW = palmW * 0.85;
  const sizeRatio = g.width / wristW;

  const minFore = palmW * TARGET_MIN_FORE;
  const maxFore = palmW * TARGET_MAX_FORE;
  const maxLat = palmW * TARGET_MAX_LATERAL;

  let cx = g.cx;
  let cy = g.cy;
  let width = g.width;
  let height = g.height;

  const centreInBand =
    forearmOffsetPx >= minFore &&
    forearmOffsetPx <= maxFore &&
    lateralPx <= maxLat;

  if (!centreInBand) {
    // Recompute the centre as a clean point on the wrist band.
    const targetFore = Math.min(
      Math.max(forearmOffsetPx, minFore),
      maxFore
    );
    cx = g.wristAnchor.x + forearm.x * targetFore;
    cy = g.wristAnchor.y + forearm.y * targetFore;
    if (forearmOffsetPx < minFore) {
      notes.push(
        `Watch was placed too close to the wrist (on the back of the hand). Re-anchored ${Math.round(
          targetFore
        )}px along forearm.`
      );
    } else if (forearmOffsetPx > maxFore) {
      notes.push(
        `Watch was placed too far down the forearm. Re-anchored ${Math.round(
          targetFore
        )}px along forearm.`
      );
    }
    if (lateralPx > maxLat) {
      notes.push(
        `Watch drifted ${Math.round(
          lateralPx
        )}px off the forearm axis. Snapped back onto it.`
      );
    }
  }

  let sizeInRange = sizeRatio >= TARGET_MIN_SIZE && sizeRatio <= TARGET_MAX_SIZE;
  if (!sizeInRange) {
    const targetSize = Math.min(
      Math.max(sizeRatio, TARGET_MIN_SIZE),
      TARGET_MAX_SIZE
    );
    const scale = targetSize / Math.max(sizeRatio, 0.0001);
    width = g.width * scale;
    height = g.height * scale;
    sizeInRange = true;
    notes.push(
      `Watch size ratio was ${sizeRatio.toFixed(
        2
      )}× wristWidth — clamped to ${targetSize.toFixed(2)}×.`
    );
  }

  return {
    centreInBand,
    sizeInRange,
    forearmOffset: forearmOffsetPx,
    lateralOffset: lateralPx,
    sizeRatio,
    corrected: { ...g, cx, cy, width, height },
    notes,
  };
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

  // watchCenter = wrist - handDir * palmWidth * 0.15
  //
  //  Anatomical anchor on the styloid process of the ulna (the bump
  //  on the back of the wrist where a watch case naturally sits).
  //  MediaPipe landmark 0 (wrist) sits roughly on the wrist crease
  //  itself; subtracting 0.15 × palmWidth toward the elbow lands us
  //  on the styloid process. Lowered from 0.26 in the anatomical
  //  pass — the previous offset placed watches mid-forearm.
  //  validateWatchPlacement enforces 0.08..0.24 as the hard range.
  const cx = wrist.x - handDir.x * palmWidth * 0.15;
  const cy = wrist.y - handDir.y * palmWidth * 0.15;

  // ── Watch width sizing (anatomy-aware) ────────────────────────────
  //
  //  Anatomically: wristWidth ≈ 0.85 × palmWidth (knuckle span).
  //  Target watch span = 0.86 × wristWidth (a realistic watch case is
  //  noticeably narrower than the wrist). Hard cap at 0.98 × wristWidth
  //  so even after user scaling the watch never reads as oversized.
  //
  //   - WATCH_TARGET_WRIST_RATIO defaults to 0.86
  //   - WATCH_MAX_WRIST_RATIO defaults to 0.98
  //
  //  Operators can tighten further via env without re-deploying.
  //  June 2026: previous defaults (0.92 / 1.08) still produced the
  //  "sticker / too big" look on portrait wrist photos.
  const targetRatioRaw = process.env.WATCH_TARGET_WRIST_RATIO?.trim();
  const targetRatio = Number(targetRatioRaw);
  const targetWristRatio = Number.isFinite(targetRatio) && targetRatio > 0
    ? targetRatio
    : 0.86;
  const wristWidth = palmWidth * 0.85;
  const targetSpan = wristWidth * targetWristRatio;
  const width = targetSpan;
  const height = width * productAspect;

  // ── Rotation (delegated to the unified watchRotation engine) ─────
  //
  //  The new engine is the single source of truth for watch rotation.
  //  It computes the forearm axis, the strap axis, the anatomical
  //  correction and a confidence-aware clamp in one place. We keep
  //  the radian result on the geometry object for backwards-compat
  //  with the renderer, AND we expose the full diagnostic structure
  //  as `rotationDebug` for downstream consumers (quality gates,
  //  debug overlays, server-side rotation validators).
  const rotationResult = computeWatchRotation({
    landmarks: lm,
    imageWidth: W,
    imageHeight: H,
  });
  const rotation = rotationResult.rotationRad;

  // Confidence: combine the rotation engine's own confidence (driven
  // by landmark visibility) with the existing palm-size sanity check.
  const sizeFactor = Math.min(1, palmWidth / (Math.min(W, H) * 0.06));
  const confidence = Math.max(
    0,
    Math.min(1, rotationResult.confidence * 0.7 + sizeFactor * 0.3)
  );

  // 3D wrist plane (PnP-lite). Drives the perspective skew so the
  // watch can wrap around the wrist instead of sitting flat on it.
  const wristPlane = computeWristPlane(lm);

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
    wristAnchor: { x: wrist.x, y: wrist.y },
    rotationDebug: rotationResult,
    wristPlane,
  };
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
    wristAnchor: { x: imageWidth * 0.5, y: imageHeight * 0.55 },
  };
}
