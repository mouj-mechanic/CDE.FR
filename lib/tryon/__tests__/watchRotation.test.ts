import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizeAngle180,
  absAngleDiff,
  clampRotationForWatch,
  computeAnatomicalRotationCorrection,
  computeWatchRotation,
  checkWatchRotationQuality,
} from "../watchRotation";
import type { TryOnLandmarks } from "../types";

// ──────────────────────────────────────────────────────────────────────
//  Pure helpers
// ──────────────────────────────────────────────────────────────────────

describe("normalizeAngle180", () => {
  it("reduces to (-180, 180]", () => {
    expect(normalizeAngle180(190)).toBe(-170);
    expect(normalizeAngle180(-190)).toBe(170);
    expect(normalizeAngle180(360)).toBe(0);
    expect(normalizeAngle180(0)).toBe(0);
    expect(normalizeAngle180(180)).toBe(180);
    expect(normalizeAngle180(-180)).toBe(180);
  });

  it("returns 0 on non-finite input", () => {
    expect(normalizeAngle180(Number.NaN)).toBe(0);
    expect(normalizeAngle180(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("absAngleDiff", () => {
  it("returns the shortest positive difference", () => {
    expect(absAngleDiff(10, 20)).toBe(10);
    expect(absAngleDiff(350, 10)).toBe(20);
    expect(absAngleDiff(170, -170)).toBe(20);
  });
});

describe("clampRotationForWatch", () => {
  it("respects values inside the soft band when confidence is high", () => {
    expect(clampRotationForWatch(45, 0.9)).toBe(45);
    expect(clampRotationForWatch(-30, 0.9)).toBe(-30);
  });

  it("never exceeds the hard band (±80°)", () => {
    expect(clampRotationForWatch(120, 1)).toBe(80);
    expect(clampRotationForWatch(-120, 1)).toBe(-80);
  });

  it("pulls extreme angles back to SOFT_MAX when confidence is low", () => {
    expect(clampRotationForWatch(75, 0.2)).toBe(65);
    expect(clampRotationForWatch(-75, 0.2)).toBe(-65);
  });

  it("does NOT pull moderate angles toward 0 (no over-correction)", () => {
    // Past bug: low confidence would erase a meaningful rotation. The
    // engine must keep a +35° estimate as-is — only extreme angles get
    // pulled back to the soft cap.
    expect(clampRotationForWatch(35, 0.05)).toBe(35);
    expect(clampRotationForWatch(-25, 0.1)).toBe(-25);
  });
});

// ──────────────────────────────────────────────────────────────────────
//  Anatomical correction
// ──────────────────────────────────────────────────────────────────────

describe("computeAnatomicalRotationCorrection", () => {
  it("returns 0 when biasDeg is 0 (default)", () => {
    expect(
      computeAnatomicalRotationCorrection({
        forearmAxisDeg: 135,
        handAxisDeg: -45,
        side: "right",
        confidence: 1,
        biasDeg: 0,
      })
    ).toBe(0);
  });

  it("applies a positive bias for a forearm pointing into the lower half", () => {
    const c = computeAnatomicalRotationCorrection({
      forearmAxisDeg: 135,
      handAxisDeg: -45,
      side: "right",
      confidence: 1,
      biasDeg: 8,
    });
    expect(c).toBe(8);
  });

  it("flips the sign for the left hand", () => {
    const c = computeAnatomicalRotationCorrection({
      forearmAxisDeg: 135,
      handAxisDeg: -45,
      side: "left",
      confidence: 1,
      biasDeg: 8,
    });
    expect(c).toBe(-8);
  });

  it("respects the hard max", () => {
    const c = computeAnatomicalRotationCorrection({
      forearmAxisDeg: 135,
      handAxisDeg: -45,
      side: "right",
      confidence: 1,
      biasDeg: 50,
      maxCorrectionDeg: 12,
    });
    expect(c).toBe(12);
  });
});

// ──────────────────────────────────────────────────────────────────────
//  computeWatchRotation — the central API
// ──────────────────────────────────────────────────────────────────────

function buildHandLandmarks(
  wrist: { x: number; y: number },
  palm: { x: number; y: number }
): TryOnLandmarks {
  // 21-landmark MediaPipe hand model. Only indices 0, 5, 9, 13, 17
  // are read by the engine — the others stay at the wrist for
  // brevity.
  const W = 1000;
  const H = 1000;
  const wn = { x: wrist.x / W, y: wrist.y / H, visibility: 0.95 };
  const pn = { x: palm.x / W, y: palm.y / H, visibility: 0.95 };
  const hand = Array.from({ length: 21 }, () => ({ ...wn }));
  hand[0] = wn;
  // Spread the 4 MCPs around the palm centre so the engine sees a
  // realistic palmWidth + a clean palm centre.
  const dx = palm.x - wrist.x;
  const dy = palm.y - wrist.y;
  const perp = { x: -dy, y: dx };
  const plen = Math.hypot(perp.x, perp.y) || 1;
  const pn1 = { x: pn.x - (perp.x / plen) * 0.04, y: pn.y - (perp.y / plen) * 0.04, visibility: 0.95 };
  const pn2 = { x: pn.x - (perp.x / plen) * 0.015, y: pn.y - (perp.y / plen) * 0.015, visibility: 0.95 };
  const pn3 = { x: pn.x + (perp.x / plen) * 0.015, y: pn.y + (perp.y / plen) * 0.015, visibility: 0.95 };
  const pn4 = { x: pn.x + (perp.x / plen) * 0.04, y: pn.y + (perp.y / plen) * 0.04, visibility: 0.95 };
  hand[5] = pn1;
  hand[9] = pn2;
  hand[13] = pn3;
  hand[17] = pn4;
  return {
    hand,
    face: [],
    pose: [],
    imageWidth: W,
    imageHeight: H,
  } as unknown as TryOnLandmarks;
}

describe("computeWatchRotation — landmarks path", () => {
  it("returns rotation ≈ 0 when the hand points straight up", () => {
    const lm = buildHandLandmarks({ x: 500, y: 700 }, { x: 500, y: 400 });
    const r = computeWatchRotation({
      landmarks: lm,
      imageWidth: 1000,
      imageHeight: 1000,
    });
    expect(Math.abs(r.rotationDeg)).toBeLessThan(2);
    expect(r.method).toBe("landmarks");
  });

  it("returns rotation ≈ +45° when forearm comes from the bottom-left", () => {
    // Forearm goes from (300, 700) down-left to (200, 900). Hand
    // points up-right.
    const lm = buildHandLandmarks({ x: 300, y: 700 }, { x: 500, y: 500 });
    const r = computeWatchRotation({
      landmarks: lm,
      imageWidth: 1000,
      imageHeight: 1000,
    });
    expect(r.rotationDeg).toBeGreaterThan(35);
    expect(r.rotationDeg).toBeLessThan(55);
    expect(r.method).toBe("landmarks");
    expect(r.baseRotationDeg).toBeCloseTo(r.rotationDeg - r.correctionDeg, 1);
  });

  it("returns rotation ≈ -45° when forearm comes from the bottom-right", () => {
    const lm = buildHandLandmarks({ x: 700, y: 700 }, { x: 500, y: 500 });
    const r = computeWatchRotation({
      landmarks: lm,
      imageWidth: 1000,
      imageHeight: 1000,
    });
    expect(r.rotationDeg).toBeLessThan(-35);
    expect(r.rotationDeg).toBeGreaterThan(-55);
  });

  it("emits a meaningful fallback when landmarks are missing", () => {
    const r = computeWatchRotation({
      landmarks: null,
      imageWidth: 1000,
      imageHeight: 1000,
    });
    expect(r.method).toBe("fallback");
    expect(r.confidence).toBe(0);
    expect(Math.abs(r.rotationDeg)).toBeLessThan(15);
  });

  it("honours PRODUCT_STRAP_AXIS_DEG when set", () => {
    const original = process.env.PRODUCT_STRAP_AXIS_DEG;
    process.env.PRODUCT_STRAP_AXIS_DEG = "0";
    try {
      // Strap axis = 0° (horizontal in the product PNG). With the
      // hand pointing straight up the forearm points DOWN (+y) so
      // forearmAxisDeg = 90°. Rotation = 90° - 0° = 90°, clamped to
      // +80°.
      const lm = buildHandLandmarks({ x: 500, y: 700 }, { x: 500, y: 400 });
      const r = computeWatchRotation({
        landmarks: lm,
        imageWidth: 1000,
        imageHeight: 1000,
      });
      expect(r.productStrapAxisDeg).toBe(0);
      expect(r.rotationDeg).toBe(80);
    } finally {
      if (original === undefined) delete process.env.PRODUCT_STRAP_AXIS_DEG;
      else process.env.PRODUCT_STRAP_AXIS_DEG = original;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
//  Env-driven correction
// ──────────────────────────────────────────────────────────────────────

describe("computeWatchRotation — env correction", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.WATCH_ROTATION_CORRECTION_DEG;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.WATCH_ROTATION_CORRECTION_DEG;
    else process.env.WATCH_ROTATION_CORRECTION_DEG = original;
  });

  it("adds the env-driven bias on top of the geometric rotation", () => {
    process.env.WATCH_ROTATION_CORRECTION_DEG = "8";
    const lm = buildHandLandmarks({ x: 300, y: 700 }, { x: 500, y: 500 });
    const r = computeWatchRotation({
      landmarks: lm,
      imageWidth: 1000,
      imageHeight: 1000,
    });
    // baseRotation is the geometric estimate. correctionDeg must be
    // non-zero when env is set + confidence > 0.
    expect(r.correctionDeg).not.toBe(0);
    expect(Math.abs(r.correctionDeg)).toBeLessThanOrEqual(12);
  });

  it("respects WATCH_ROTATION_MAX_CORRECTION_DEG cap", () => {
    process.env.WATCH_ROTATION_CORRECTION_DEG = "50";
    process.env.WATCH_ROTATION_MAX_CORRECTION_DEG = "5";
    try {
      const lm = buildHandLandmarks({ x: 300, y: 700 }, { x: 500, y: 500 });
      const r = computeWatchRotation({
        landmarks: lm,
        imageWidth: 1000,
        imageHeight: 1000,
      });
      expect(Math.abs(r.correctionDeg)).toBeLessThanOrEqual(5);
    } finally {
      delete process.env.WATCH_ROTATION_MAX_CORRECTION_DEG;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
//  Quality gate
// ──────────────────────────────────────────────────────────────────────

describe("checkWatchRotationQuality", () => {
  it("passes when the actual axis matches the forearm within ±12°", () => {
    const out = checkWatchRotationQuality({
      finalRotationDeg: 45,
      forearmAxisDeg: 135,
      productStrapAxisDeg: 90,
    });
    expect(out.valid).toBe(true);
    expect(out.acceptable).toBe(true);
    expect(out.reason).toBe("ok");
    expect(out.diffDeg).toBeLessThanOrEqual(1);
  });

  it("warns when the drift is between 12° and 20°", () => {
    const out = checkWatchRotationQuality({
      finalRotationDeg: 30,
      forearmAxisDeg: 135,
      productStrapAxisDeg: 90,
    });
    expect(out.valid).toBe(false);
    expect(out.acceptable).toBe(true);
    expect(out.reason).toBe("warn");
  });

  it("fails past the warn band", () => {
    const out = checkWatchRotationQuality({
      finalRotationDeg: 0,
      forearmAxisDeg: 145,
      productStrapAxisDeg: 90,
    });
    expect(out.valid).toBe(false);
    expect(out.acceptable).toBe(false);
    expect(out.reason).toBe("fail");
  });

  it("treats 180°-flipped angles as equivalent (strap is a line)", () => {
    // A watch rotated by 180° looks the same when worn — the dial
    // points the same way along the strap line. We must not flag
    // that as a rotation failure.
    const out = checkWatchRotationQuality({
      finalRotationDeg: 45,
      forearmAxisDeg: -45, // = 135° on the strap line
      productStrapAxisDeg: 90,
    });
    expect(out.valid).toBe(true);
  });
});
