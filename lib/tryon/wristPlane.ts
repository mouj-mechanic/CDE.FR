/**
 * 3D wrist plane estimator (lightweight PnP).
 *
 *  The hand is treated as a flat plane spanned by three MediaPipe
 *  hand landmarks:
 *
 *      P0 — wrist             (landmark 0)
 *      P1 — thumb CMC         (landmark 1)
 *      P17 — pinky MCP        (landmark 17)
 *
 *  MediaPipe exposes a relative `z` coordinate for each landmark
 *  (negative = closer to the camera). When `z` is available we
 *  compute the actual 3D normal of the plane via the cross product;
 *  when it is missing (some hand models drop z) we fall back to a
 *  2D approximation that is still meaningful for foreshortening.
 *
 *  Returned angles (degrees, image-space convention):
 *
 *      pitch — rotation around the wrist axis (how much the dial
 *              tilts toward or away from the camera). Positive =
 *              dial faces the camera; negative = dial faces away
 *              (e.g. arm seen from above).
 *      yaw   — rotation around the forearm axis (how much the
 *              dial tilts left/right). Positive = dial faces toward
 *              the +X side of the image.
 *
 *  The pipeline uses `foreshorteningFactor` (in [0..1]) to compress
 *  the strap-axis dimension of the watch when the plane is tilted
 *  away from the camera. This is the cheap-and-correct cue that
 *  turns a flat-sticker watch into a worn watch.
 */

import type { LandmarkPoint, TryOnLandmarks } from "./types";

export interface WristPlaneResult {
  /** True when the plane was estimated from real MediaPipe z values. */
  has3DDepth: boolean;
  /** Normal of the plane in image coords (+x right, +y down, +z toward camera). */
  normal: { x: number; y: number; z: number };
  /** Pitch in degrees (see file-level comment). */
  pitchDeg: number;
  /** Yaw in degrees. */
  yawDeg: number;
  /**
   * Magnitude of the tilt away from the camera frontal plane, in
   * degrees. 0 = perfectly frontal, 90 = edge-on.
   */
  tiltMagnitudeDeg: number;
  /**
   * Foreshortening multiplier in [0.5..1] applied to the strap-axis
   * dimension when rendering. 1 = no foreshortening, 0.5 = aggressive
   * compression (very tilted wrist).
   */
  foreshorteningFactor: number;
  /**
   * Confidence in the plane estimation [0..1]. Combines landmark
   * visibility + presence of usable z.
   */
  confidence: number;
  /** Diagnostic vectors for QA overlays. */
  debugVectors: {
    p0: { x: number; y: number; z: number };
    p1: { x: number; y: number; z: number };
    p17: { x: number; y: number; z: number };
    /** "Width" vector across the wrist (p1 → p17). */
    edgeAcross: { x: number; y: number; z: number };
    /** "Down the forearm" vector (palm → wrist). */
    edgeAlong: { x: number; y: number; z: number };
  };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function norm(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Lift a MediaPipe normalized landmark into image-space 3D. The `z`
 * coordinate is relative — MediaPipe documents it as "approximately
 * the same scale as x" when normalised, so we multiply by the image
 * diagonal to put it on the same scale as pixel distances.
 */
function lift(
  lm: LandmarkPoint,
  W: number,
  H: number,
  scaleZ: number
): Vec3 {
  return {
    x: lm.x * W,
    y: lm.y * H,
    z: (lm.z ?? 0) * scaleZ,
  };
}

export function computeWristPlane(
  lm: TryOnLandmarks | null | undefined
): WristPlaneResult {
  const hand = lm?.hand ?? null;
  const W = lm?.imageWidth ?? 1024;
  const H = lm?.imageHeight ?? 1024;
  const scaleZ = Math.hypot(W, H);

  // ── Fallback when landmarks are unusable ──────────────────────────
  if (!hand || hand.length < 18) {
    return {
      has3DDepth: false,
      normal: { x: 0, y: 0, z: 1 },
      pitchDeg: 0,
      yawDeg: 0,
      tiltMagnitudeDeg: 0,
      foreshorteningFactor: 1,
      confidence: 0,
      debugVectors: {
        p0: { x: 0, y: 0, z: 0 },
        p1: { x: 0, y: 0, z: 0 },
        p17: { x: 0, y: 0, z: 0 },
        edgeAcross: { x: 1, y: 0, z: 0 },
        edgeAlong: { x: 0, y: 1, z: 0 },
      },
    };
  }

  const p0 = lift(hand[0], W, H, scaleZ);
  const p1 = lift(hand[1], W, H, scaleZ);
  const p17 = lift(hand[17], W, H, scaleZ);
  const has3DDepth =
    typeof hand[0].z === "number" &&
    typeof hand[1].z === "number" &&
    typeof hand[17].z === "number" &&
    Math.abs(hand[0].z!) + Math.abs(hand[1].z!) + Math.abs(hand[17].z!) > 1e-6;

  // Edge vectors across the wrist (p1 → p17) and along the forearm
  // (the palm centre — average of MCPs — toward the wrist).
  const palmCentre =
    hand.length >= 18
      ? {
          x:
            ((hand[5]?.x ?? 0) +
              (hand[9]?.x ?? 0) +
              (hand[13]?.x ?? 0) +
              (hand[17]?.x ?? 0)) /
            4 *
            W,
          y:
            ((hand[5]?.y ?? 0) +
              (hand[9]?.y ?? 0) +
              (hand[13]?.y ?? 0) +
              (hand[17]?.y ?? 0)) /
            4 *
            H,
          z:
            ((hand[5]?.z ?? 0) +
              (hand[9]?.z ?? 0) +
              (hand[13]?.z ?? 0) +
              (hand[17]?.z ?? 0)) /
            4 *
            scaleZ,
        }
      : p0;
  const edgeAcross = sub(p17, p1);
  const edgeAlong = sub(p0, palmCentre);

  // Plane normal = cross(edgeAlong, edgeAcross). When z is missing
  // the cross product collapses to ±|edgeAcross × edgeAlong| * ẑ —
  // i.e. a normal pointing straight toward the camera, which is the
  // correct neutral fallback.
  const planeNormalRaw = cross(edgeAlong, edgeAcross);
  const planeNormal = norm(planeNormalRaw);
  // We want the normal to point TOWARD the camera (-z in image
  // convention, since +z = away from camera). Flip if needed.
  const cameraDir: Vec3 = { x: 0, y: 0, z: -1 };
  let n = planeNormal;
  if (dot(n, cameraDir) < 0) {
    n = { x: -n.x, y: -n.y, z: -n.z };
  }

  // Tilt magnitude = angle between plane normal and camera direction.
  // 0 = plane fronto-parallel, 90 = plane parallel to camera ray (edge-on).
  const cosTilt = Math.max(-1, Math.min(1, dot(n, cameraDir)));
  const tiltMagnitudeDeg = (Math.acos(cosTilt) * 180) / Math.PI;

  // Decompose into pitch (rotation around the wrist axis = edgeAcross)
  // and yaw (rotation around the forearm axis = edgeAlong).
  // Pitch: project the normal onto the (forearm-axis, camera-axis) plane.
  const along = norm(edgeAlong);
  const across = norm(edgeAcross);
  const pitchVec = sub(n, scale3(across, dot(n, across)));
  const pitchDeg =
    (Math.atan2(pitchVec.z, -dot(pitchVec, along)) * 180) / Math.PI;
  const yawVec = sub(n, scale3(along, dot(n, along)));
  const yawDeg =
    (Math.atan2(yawVec.z, -dot(yawVec, across)) * 180) / Math.PI;

  // Foreshortening factor along the strap axis. At 0° tilt = 1.0,
  // at 60° tilt = cos(60°) ≈ 0.5 (which is our floor — past 60° we
  // stop compressing further so the watch doesn't disappear).
  const tiltClamped = Math.min(60, tiltMagnitudeDeg);
  const foreshorteningFactor = Math.max(
    0.5,
    Math.cos((tiltClamped * Math.PI) / 180)
  );

  const visAvg = avgVisibility(hand, [0, 1, 17]);
  const depthBoost = has3DDepth ? 0.4 : 0;
  const confidence = Math.max(0, Math.min(1, visAvg * 0.6 + depthBoost + 0.2));

  return {
    has3DDepth,
    normal: n,
    pitchDeg,
    yawDeg,
    tiltMagnitudeDeg,
    foreshorteningFactor,
    confidence,
    debugVectors: {
      p0,
      p1,
      p17,
      edgeAcross,
      edgeAlong,
    },
  };
}

function scale3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
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
  if (count === 0) return 0.85;
  return sum / count;
}
