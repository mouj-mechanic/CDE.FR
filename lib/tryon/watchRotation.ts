/**
 * Unified watch rotation engine.
 *
 *  The goal is simple but had been spread across several files and
 *  was hard to reason about:
 *
 *      rotationDeg = forearmAxisDeg - productStrapAxisDeg + correctionDeg
 *
 *  - `forearmAxisDeg` — direction of the forearm in image coordinates
 *    (wrist → elbow). Image coords: +x right, +y DOWN, so a forearm
 *    going from a wrist at (300, 700) toward an elbow at (200, 900)
 *    has axis (−1, +2)/|…| and angle ≈ 116°.
 *  - `productStrapAxisDeg` — direction of the watch strap in the
 *    product PNG. Standard product photos have the strap vertical
 *    (12h → 6h ≈ down in the image), so the default is 90°. Operators
 *    can override per-product if their catalogue is photographed at
 *    an angle.
 *  - `correctionDeg` — small anatomical bias (e.g. +8° for hands
 *    captured from below). Bounded by the env-driven max.
 *
 *  Everything is in DEGREES inside this module — the only place we
 *  convert to radians is the consumer (canvas / sharp rotate calls).
 *
 *  See README "Watch rotation model" for the full derivation.
 */

import type { LandmarkPoint, TryOnLandmarks } from "./types";

export interface Vec2 {
  x: number;
  y: number;
}

export type HandSide = "left" | "right" | "unknown";

export interface ProductMeta {
  /**
   * Direction of the watch strap inside the product PNG, in degrees
   * from +X axis (image convention). 90° = strap pointing down (the
   * typical "front" product photo). Configure per-product when your
   * catalogue is photographed at an angle.
   */
  strapAxisDeg?: number;
}

export interface WatchRotationInput {
  /** MediaPipe hand landmarks (21 points expected). Optional. */
  landmarks?: TryOnLandmarks | null;
  /** Image width / height in pixels (used to convert normalised landmarks). */
  imageWidth: number;
  imageHeight: number;
  /** Optional per-product metadata. */
  productMeta?: ProductMeta;
  /**
   * Confidence floor. When MediaPipe confidence drops below this, the
   * function still emits a rotation but bumps the `method` to "fallback".
   */
  minConfidence?: number;
  /** Forced hand side; defaults to landmark-derived value. */
  side?: HandSide;
}

export interface WatchRotationResult {
  /** Final rotation to apply to the watch PNG in degrees. */
  rotationDeg: number;
  /** Same value in radians for canvas / sharp consumers. */
  rotationRad: number;
  /** Direction of the forearm in image coords, degrees from +X. */
  forearmAxisDeg: number;
  /** Direction of the hand (wrist → palm) in image coords, degrees from +X. */
  handAxisDeg: number;
  /**
   * Direction perpendicular to the forearm (the watch dial spans this
   * axis when worn). Degrees from +X.
   */
  wristAxisDeg: number;
  /** Strap axis of the product PNG. Default 90°. */
  productStrapAxisDeg: number;
  /** Pre-clamp base rotation (= forearmAxisDeg - productStrapAxisDeg). */
  baseRotationDeg: number;
  /** Anatomical correction added after the base rotation. */
  correctionDeg: number;
  /** Hand side used. */
  side: HandSide;
  /** Confidence in [0..1]. */
  confidence: number;
  /** Diagnostic label for QA dashboards: `landmarks` / `fallback` / `manual`. */
  method: "landmarks" | "fallback" | "manual";
  /**
   * True when the "force-min-on-diagonal" safety bumped the rotation
   * because the forearm was clearly diagonal but the geometric
   * estimate was suspiciously close to 0°. See `forceMinimumRotationForDiagonalForearm`.
   */
  forcedMinimumApplied?: boolean;
  /**
   * Useful unit vectors for downstream rendering. Image convention
   * (+x right, +y down).
   */
  debugVectors: {
    handDir: Vec2;
    forearm: Vec2;
    wrist: Vec2;
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  pure helpers — fully testable
// ──────────────────────────────────────────────────────────────────────────

/**
 * Reduce an angle in degrees to the interval (-180, 180].
 * Robust for any input including +/-Infinity (returns 0).
 */
export function normalizeAngle180(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Absolute angular difference in degrees, in [0..180]. */
export function absAngleDiff(a: number, b: number): number {
  return Math.abs(normalizeAngle180(a - b));
}

/**
 * Clamp the rotation to a reasonable band based on confidence. With
 * high confidence we honour the geometric estimate (±65°); with
 * low confidence we pull values toward 0 (so a noisy landmark drop
 * doesn't make the watch flip). Past the hard band (±80°) we always
 * clamp regardless of confidence — a watch tilted more than 80° on a
 * wrist is almost certainly a landmark mistake.
 */
export function clampRotationForWatch(
  deg: number,
  confidence: number
): number {
  const normalized = normalizeAngle180(deg);
  const HARD_MAX = 80;
  const SOFT_MAX = 65;
  const clamped = Math.max(-HARD_MAX, Math.min(HARD_MAX, normalized));
  if (Math.abs(clamped) <= SOFT_MAX) return clamped;
  if (!Number.isFinite(confidence) || confidence >= 0.6) return clamped;
  // Low confidence + extreme angle: blend back toward SOFT_MAX so we
  // never flip a watch upside down on bad detections.
  const sign = clamped < 0 ? -1 : 1;
  return sign * SOFT_MAX;
}

/**
 * Anatomical correction in degrees. The watch is typically a bit too
 * "flat" relative to the forearm axis because we use the wrist
 * (landmark 0) which sits slightly forward of the actual radius bone.
 * A small per-side bias compensates for this.
 *
 *  Defaults are conservative: ±0° unless WATCH_ROTATION_CORRECTION_DEG
 *  is set. We never apply more than ±MAX (default 12°).
 */
export function computeAnatomicalRotationCorrection(input: {
  forearmAxisDeg: number;
  handAxisDeg: number;
  side: HandSide;
  confidence: number;
  /** Env-driven bias (`WATCH_ROTATION_CORRECTION_DEG`). 0 to disable. */
  biasDeg?: number;
  /** Hard absolute cap on correction magnitude. */
  maxCorrectionDeg?: number;
}): number {
  const max = Math.abs(input.maxCorrectionDeg ?? 12);
  const bias = input.biasDeg ?? 0;
  if (bias === 0) return 0;
  // The correction sign is tied to which way the forearm points. For
  // a typical portrait wrist photo the bias rotates the watch toward
  // the forearm direction by a small amount. We use the forearm
  // axis to decide the sign:
  //   forearm pointing down-right (45°..135°) → positive bias
  //   forearm pointing up-left   (-135°..-45°) → negative bias
  const forearm = normalizeAngle180(input.forearmAxisDeg);
  let sign = 0;
  if (forearm > 0 && forearm < 180) sign = 1;
  else if (forearm < 0 && forearm > -180) sign = -1;
  // Confidence-scale the bias so low-confidence runs apply less.
  const scaled = bias * Math.min(1, Math.max(0, input.confidence));
  let correction = sign * scaled;
  // Side flip: mirror hands get the opposite anatomical bias.
  if (input.side === "left") correction = -correction;
  return Math.max(-max, Math.min(max, correction));
}

// ──────────────────────────────────────────────────────────────────────────
//  landmark helpers
// ──────────────────────────────────────────────────────────────────────────

function px(p: LandmarkPoint, w: number, h: number): Vec2 {
  return { x: p.x * w, y: p.y * h };
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

function angleDeg(v: Vec2): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI;
}

/**
 * Estimate the hand side (left / right) from MediaPipe landmarks.
 * MediaPipe exposes "Handedness" but we don't always have it; we
 * approximate from the relative position of thumb vs. pinky.
 *
 *   - thumb to the LEFT of pinky in image → right hand
 *   - thumb to the RIGHT of pinky in image → left hand
 *
 *  Returns "unknown" when MediaPipe didn't give us the relevant
 *  landmarks.
 */
function estimateHandSide(
  hand: LandmarkPoint[],
  w: number,
  h: number
): HandSide {
  if (!hand || hand.length < 18) return "unknown";
  const thumbCmc = px(hand[1], w, h);
  const pinkyMcp = px(hand[17], w, h);
  if (thumbCmc.x < pinkyMcp.x) return "right";
  if (thumbCmc.x > pinkyMcp.x) return "left";
  return "unknown";
}

function envCorrectionBias(): number {
  const raw = process.env.WATCH_ROTATION_CORRECTION_DEG?.trim();
  const v = raw ? Number(raw) : 0;
  return Number.isFinite(v) ? v : 0;
}

function envMaxCorrection(): number {
  const raw = process.env.WATCH_ROTATION_MAX_CORRECTION_DEG?.trim();
  const v = raw ? Number(raw) : 12;
  return Number.isFinite(v) && v > 0 ? v : 12;
}

function envForceMinOnDiagonal(): boolean {
  // Default ON: when the forearm is clearly diagonal (>15° off
  // vertical) but the computed rotation is suspiciously small
  // (|deg| < 15°), bump the rotation to a visible angle. Catches
  // both the "MediaPipe missed the wrist landmark" and "landmarks
  // suggest a vertical hand even though the photo is diagonal"
  // failure modes that produce sticker-flat watches in production.
  const raw = process.env.WATCH_ROTATION_FORCE_MIN_ON_DIAGONAL?.trim();
  if (raw === undefined || raw === "") return true;
  return raw.toLowerCase() !== "false" && raw !== "0";
}

function envForceMinTargetDeg(): number {
  const raw = process.env.WATCH_ROTATION_FORCE_MIN_DEG?.trim();
  const v = raw ? Number(raw) : 32;
  return Number.isFinite(v) && v > 0 ? v : 32;
}

function envDiagonalThresholdDeg(): number {
  const raw = process.env.WATCH_ROTATION_DIAGONAL_THRESHOLD_DEG?.trim();
  const v = raw ? Number(raw) : 15;
  return Number.isFinite(v) && v > 0 ? v : 15;
}

/**
 * Decide whether the forearm direction is "diagonal" enough to warrant
 * a visible watch rotation. A vertical forearm (≈ 90° or -90°) is
 * naturally aligned with a vertical strap and should NOT be force-
 * rotated. A diagonal forearm (e.g. 130° = coming from bottom-left)
 * MUST produce a non-zero rotation.
 *
 *  Returns the SIGN of the expected rotation (+1 for forearms in the
 *  90..180° band, -1 for forearms in the 0..-90° band) and 0 when the
 *  forearm is close enough to vertical to skip the safety.
 */
export function forceMinimumRotationForDiagonalForearm(input: {
  forearmAxisDeg: number;
  currentRotationDeg: number;
  thresholdDeg?: number;
  targetDeg?: number;
  side?: HandSide;
}): { rotationDeg: number; forced: boolean } {
  // We use a CONTINUOUS amplification rather than a hard threshold
  // so even small forearm tilts produce a visible (if subtle) watch
  // rotation. The previous "all-or-nothing" force at 15° threshold
  // missed the very common case of a wrist photo where the forearm
  // is only 5-12° off vertical — geometrically correct but visually
  // boring because a strictly vertical strap reads as a sticker.
  const threshold = Math.abs(input.thresholdDeg ?? 3); // 3° dead zone
  const target = Math.abs(input.targetDeg ?? 35);
  const forearm = normalizeAngle180(input.forearmAxisDeg);

  const distFromVertical = Math.min(
    Math.abs(forearm - 90),
    Math.abs(forearm + 90)
  );
  // Truly vertical (within `threshold` deadzone) → no forcing.
  if (distFromVertical <= threshold) {
    return { rotationDeg: input.currentRotationDeg, forced: false };
  }
  // The current rotation is already meaningfully tilted in the
  // right direction → leave it alone.
  if (Math.abs(input.currentRotationDeg) >= 18) {
    return { rotationDeg: input.currentRotationDeg, forced: false };
  }
  // Determine the expected sign of rotation:
  //   forearm in (90°, 180°]   → bottom-left arm  → positive rotation
  //   forearm in [-180°, -90°) → top-left arm     → negative rotation
  //   forearm in (0°, 90°)     → bottom-right arm → negative rotation
  //   forearm in (-90°, 0°)    → top-right arm    → positive rotation
  let sign: number;
  if (forearm > 90 || forearm < -90) {
    sign = forearm > 0 ? 1 : -1;
  } else {
    sign = forearm > 0 ? -1 : 1;
  }
  if (input.side === "left") sign = -sign;
  // Amplify the actual tilt by 2× and clamp by `target`. A 5° tilt
  // → 10° rotation; a 15° tilt → 30°; a 20° tilt → capped at target.
  //  This makes ALL noticeable tilts produce a perceptibly rotated
  //  watch, while preserving the geometric direction.
  const amplified = Math.min(target, Math.max(distFromVertical * 2, 12));
  return { rotationDeg: sign * amplified, forced: true };
}

function envProductStrapAxis(meta?: ProductMeta): number {
  if (meta && typeof meta.strapAxisDeg === "number") {
    return meta.strapAxisDeg;
  }
  const raw = process.env.PRODUCT_STRAP_AXIS_DEG?.trim();
  const v = raw ? Number(raw) : 90;
  return Number.isFinite(v) ? v : 90;
}

// ──────────────────────────────────────────────────────────────────────────
//  main entry — computeWatchRotation
// ──────────────────────────────────────────────────────────────────────────

export function computeWatchRotation(
  input: WatchRotationInput
): WatchRotationResult {
  const W = input.imageWidth;
  const H = input.imageHeight;
  const strapAxis = envProductStrapAxis(input.productMeta);

  const hand = input.landmarks?.hand ?? null;
  if (hand && hand.length >= 21) {
    const wrist = px(hand[0], W, H);
    const indexMcp = px(hand[5], W, H);
    const middleMcp = px(hand[9], W, H);
    const ringMcp = px(hand[13], W, H);
    const pinkyMcp = px(hand[17], W, H);
    const palmCenter: Vec2 = {
      x: (indexMcp.x + middleMcp.x + ringMcp.x + pinkyMcp.x) / 4,
      y: (indexMcp.y + middleMcp.y + ringMcp.y + pinkyMcp.y) / 4,
    };
    const handDir = normalize({
      x: palmCenter.x - wrist.x,
      y: palmCenter.y - wrist.y,
    });
    const forearm: Vec2 = { x: -handDir.x, y: -handDir.y };
    const wristAxis: Vec2 = { x: -handDir.y, y: handDir.x };

    const handAxisDeg = normalizeAngle180(angleDeg(handDir));
    const forearmAxisDeg = normalizeAngle180(angleDeg(forearm));
    const wristAxisDeg = normalizeAngle180(angleDeg(wristAxis));

    const baseRotationDeg = normalizeAngle180(forearmAxisDeg - strapAxis);

    const side = input.side ?? estimateHandSide(hand, W, H);
    const visAvg = avgVisibility(hand, [0, 5, 9, 13, 17]);
    const palmWidth = Math.hypot(
      indexMcp.x - pinkyMcp.x,
      indexMcp.y - pinkyMcp.y
    );
    const sizeFactor = Math.min(1, palmWidth / (Math.min(W, H) * 0.06));
    const confidence = Math.max(
      0,
      Math.min(1, visAvg * 0.6 + sizeFactor * 0.4)
    );

    const correctionDeg = computeAnatomicalRotationCorrection({
      forearmAxisDeg,
      handAxisDeg,
      side,
      confidence,
      biasDeg: envCorrectionBias(),
      maxCorrectionDeg: envMaxCorrection(),
    });

    const beforeClamp = baseRotationDeg + correctionDeg;
    let rotationDeg = clampRotationForWatch(beforeClamp, confidence);

    // Safety: force a visible rotation when the forearm is clearly
    // diagonal but the geometric estimate landed near 0°. Catches
    // landmark mistakes that would otherwise produce a sticker-flat
    // watch on photos where the forearm is obviously diagonal.
    let forcedMinimumApplied = false;
    if (envForceMinOnDiagonal()) {
      const forced = forceMinimumRotationForDiagonalForearm({
        forearmAxisDeg,
        currentRotationDeg: rotationDeg,
        thresholdDeg: envDiagonalThresholdDeg(),
        targetDeg: envForceMinTargetDeg(),
        side,
      });
      if (forced.forced) {
        rotationDeg = clampRotationForWatch(forced.rotationDeg, 1);
        forcedMinimumApplied = true;
      }
    }
    const rotationRad = (rotationDeg * Math.PI) / 180;

    const result: WatchRotationResult = {
      rotationDeg,
      rotationRad,
      forearmAxisDeg,
      handAxisDeg,
      wristAxisDeg,
      productStrapAxisDeg: strapAxis,
      baseRotationDeg,
      correctionDeg,
      side,
      confidence,
      method:
        confidence < (input.minConfidence ?? 0.35) ? "fallback" : "landmarks",
      forcedMinimumApplied,
      debugVectors: {
        handDir,
        forearm,
        wrist,
      },
    };

    if (typeof console !== "undefined" && console.info) {
      console.info("[WATCH_ROTATION] geometry", {
        forearmAxisDeg: round(forearmAxisDeg),
        productStrapAxisDeg: round(strapAxis),
        baseRotationDeg: round(baseRotationDeg),
        correctionDeg: round(correctionDeg),
        finalRotationDeg: round(rotationDeg),
        forcedMinimumApplied,
        confidence: round(confidence, 2),
        side,
        method: result.method,
      });
    }
    return result;
  }

  // ── Fallback — landmarks unavailable ──────────────────────────────
  // Default assumption: portrait wrist photo. The wrist sits near
  // the top of the frame and the forearm exits the bottom, so the
  // forearm direction in image coords is +y (down) ≈ 90°. With the
  // default strap axis of 90° this yields a base rotation of 0°,
  // which is the most likely-correct guess when we don't have
  // landmarks. Operators can override the strap axis via
  // `PRODUCT_STRAP_AXIS_DEG`.
  const forearmAxisDeg = 90;
  const baseRotationDeg = normalizeAngle180(forearmAxisDeg - strapAxis);
  const correctionDeg = computeAnatomicalRotationCorrection({
    forearmAxisDeg,
    handAxisDeg: 90,
    side: input.side ?? "unknown",
    confidence: 0,
    biasDeg: envCorrectionBias() * 0.5,
    maxCorrectionDeg: envMaxCorrection(),
  });
  const rotationDeg = clampRotationForWatch(
    baseRotationDeg + correctionDeg,
    0
  );
  const fallbackResult: WatchRotationResult = {
    rotationDeg,
    rotationRad: (rotationDeg * Math.PI) / 180,
    forearmAxisDeg,
    handAxisDeg: 90,
    wristAxisDeg: 0,
    productStrapAxisDeg: strapAxis,
    baseRotationDeg,
    correctionDeg,
    side: input.side ?? "unknown",
    confidence: 0,
    method: "fallback",
    forcedMinimumApplied: false,
    debugVectors: {
      handDir: { x: 0, y: -1 },
      forearm: { x: 0, y: 1 },
      wrist: { x: W / 2, y: H * 0.55 },
    },
  };
  if (typeof console !== "undefined" && console.info) {
    console.info("[WATCH_ROTATION] geometry-fallback", {
      forearmAxisDeg: round(forearmAxisDeg),
      productStrapAxisDeg: round(strapAxis),
      baseRotationDeg: round(baseRotationDeg),
      correctionDeg: round(correctionDeg),
      finalRotationDeg: round(rotationDeg),
      method: "fallback",
    });
  }
  return fallbackResult;
}

function round(v: number, digits = 1): number {
  if (!Number.isFinite(v)) return 0;
  const m = Math.pow(10, digits);
  return Math.round(v * m) / m;
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

// ──────────────────────────────────────────────────────────────────────────
//  quality gate
// ──────────────────────────────────────────────────────────────────────────

export interface RotationQualityInput {
  /** Final rotation that was applied to the product PNG (degrees). */
  finalRotationDeg: number;
  /** Forearm direction in image coords, degrees. */
  forearmAxisDeg: number;
  /** Strap axis of the product PNG. Default 90°. */
  productStrapAxisDeg?: number;
  /** Tight tolerance — values inside this band pass cleanly. */
  toleranceDeg?: number;
  /** Wider warning band — values inside this band pass with a warning. */
  warnDeg?: number;
}

export interface RotationQualityResult {
  /** True when the actual product axis matches the forearm direction
   *  within `toleranceDeg`. */
  valid: boolean;
  /** True when valid OR within the (wider) warn band. */
  acceptable: boolean;
  /** Effective angular drift between actual and expected axis. */
  diffDeg: number;
  /** Expected = strap axis rotated by final rotation. */
  expectedAxisDeg: number;
  /** Actual = forearm direction. */
  actualAxisDeg: number;
  /** Stable reason code for debug. */
  reason: "ok" | "warn" | "fail";
}

/**
 * Verify that the actual product strap axis (after the rotation we
 * applied) really points along the forearm. Use this gate AFTER you
 * computed the final rotation but BEFORE you commit to rendering.
 * When `reason === "fail"`, callers should recompute or fall back to
 * the deterministic composite — never ship a watch tilted way off
 * the wrist axis.
 */
export function checkWatchRotationQuality(
  input: RotationQualityInput
): RotationQualityResult {
  const strap = input.productStrapAxisDeg ?? 90;
  const tol = Math.abs(input.toleranceDeg ?? 12);
  const warn = Math.abs(input.warnDeg ?? 20);
  const expected = normalizeAngle180(strap + input.finalRotationDeg);
  const actual = normalizeAngle180(input.forearmAxisDeg);
  // The strap is a "line" not a "ray" — a 180° flipped rotation is
  // physically the same orientation for the watch. So we compare
  // angles modulo 180.
  const diffRaw = absAngleDiff(expected, actual);
  const diffDeg = Math.min(diffRaw, Math.abs(180 - diffRaw));
  const valid = diffDeg <= tol;
  const acceptable = diffDeg <= warn;
  return {
    valid,
    acceptable,
    diffDeg,
    expectedAxisDeg: expected,
    actualAxisDeg: actual,
    reason: valid ? "ok" : acceptable ? "warn" : "fail",
  };
}
