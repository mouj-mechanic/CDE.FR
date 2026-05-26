import { describe, it, expect } from "vitest";
import {
  validateWatchPlacement,
  fallbackWristGeometry,
  type WristGeometry,
} from "../watchGeometry";

/**
 * Most placement bugs come from manual offsetX/offsetY pushing the watch
 * onto the back of the hand or mid-forearm. validateWatchPlacement is
 * supposed to detect that and re-anchor the watch onto the wrist band.
 *
 *  We do not test computeWristGeometry directly here because it depends
 *  on a 21-landmark hand model — the unit under test is the placement
 *  validation logic itself.
 */

function baseGeometry(): WristGeometry {
  // Horizontal forearm pointing right (+X). The wrist anchor sits at
  // (500, 500) of an arbitrary image. palmWidth = 200 px so the new
  // anatomical target band sits between 16 (0.08 × 200) and 48
  // (0.24 × 200) px to the right of the wrist anchor.
  const palmWidth = 200;
  return {
    cx: 500 + palmWidth * 0.15, // 30 px along forearm → centre of band
    cy: 500,
    width: palmWidth * 0.85 * 0.92, // ≈ 0.78 × palmWidth — in range
    height: palmWidth * 0.35,
    rotation: 0,
    palmWidth,
    axis: { x: 0, y: -1 },
    forearm: { x: 1, y: 0 },
    confidence: 0.9,
    wristAnchor: { x: 500, y: 500 },
  };
}

describe("validateWatchPlacement", () => {
  it("accepts a watch already in the wrist band", () => {
    const v = validateWatchPlacement(baseGeometry());
    expect(v.centreInBand).toBe(true);
    expect(v.sizeInRange).toBe(true);
    expect(v.notes).toHaveLength(0);
    expect(v.corrected.cx).toBe(baseGeometry().cx);
    expect(v.corrected.cy).toBe(baseGeometry().cy);
  });

  it("re-anchors a watch placed on the back of the hand", () => {
    const g = baseGeometry();
    // Pull the watch onto the hand (negative forearm offset → wrist
    // crease and past it). The target band starts at +16 px (0.08 × palm).
    g.cx = 505; // only 5px along forearm — too close to wrist
    const v = validateWatchPlacement(g);
    expect(v.centreInBand).toBe(false);
    // The corrected centre must satisfy the band rule (16..48 px along forearm).
    const fx = v.corrected.cx - g.wristAnchor.x;
    expect(fx).toBeGreaterThanOrEqual(16);
    expect(fx).toBeLessThanOrEqual(48);
    expect(v.notes.join(" ")).toMatch(/back of the hand|forearm/i);
  });

  it("re-anchors a watch placed too far down the forearm", () => {
    const g = baseGeometry();
    g.cx = g.wristAnchor.x + 180; // 180 px along forearm — past the band
    const v = validateWatchPlacement(g);
    expect(v.centreInBand).toBe(false);
    const fx = v.corrected.cx - g.wristAnchor.x;
    expect(fx).toBeLessThanOrEqual(48); // new max = palm × 0.24 = 48
    expect(v.notes.join(" ")).toMatch(/down the forearm/i);
  });

  it("snaps a lateral drift back onto the forearm axis", () => {
    const g = baseGeometry();
    // 30 px along forearm + 80 px sideways. Lateral cap = 36 (palm*0.18).
    g.cx = g.wristAnchor.x + 30;
    g.cy = g.wristAnchor.y + 80;
    const v = validateWatchPlacement(g);
    expect(v.centreInBand).toBe(false);
    // After correction the centre must lie exactly on the forearm axis
    // through the wrist anchor.
    expect(v.corrected.cy).toBe(g.wristAnchor.y);
    expect(v.notes.join(" ")).toMatch(/forearm axis|drifted/i);
  });

  it("clamps an oversized watch down to the new 0.98× max", () => {
    const g = baseGeometry();
    g.width = g.palmWidth * 1.5; // ~1.76× wristWidth — way above the cap
    g.height = g.palmWidth * 0.7;
    const v = validateWatchPlacement(g);
    expect(v.sizeInRange).toBe(true);
    const wristWidth = g.palmWidth * 0.85;
    expect(v.corrected.width / wristWidth).toBeLessThanOrEqual(0.98 + 1e-6);
    expect(v.notes.join(" ")).toMatch(/size ratio|clamped/i);
  });

  it("scales up an undersized watch to the new 0.72× min", () => {
    const g = baseGeometry();
    g.width = g.palmWidth * 0.2; // way under min
    g.height = g.palmWidth * 0.1;
    const v = validateWatchPlacement(g);
    expect(v.sizeInRange).toBe(true);
    const wristWidth = g.palmWidth * 0.85;
    expect(v.corrected.width / wristWidth).toBeGreaterThanOrEqual(0.72 - 1e-6);
  });
});

describe("fallbackWristGeometry", () => {
  it("emits coherent fallback values when landmarks are missing", () => {
    const g = fallbackWristGeometry(1024, 1024, 0.4);
    expect(g.cx).toBeGreaterThan(0);
    expect(g.width).toBeGreaterThan(0);
    expect(g.wristAnchor.x).toBe(g.cx);
    expect(g.wristAnchor.y).toBe(g.cy);
    expect(g.confidence).toBe(0);
  });
});
