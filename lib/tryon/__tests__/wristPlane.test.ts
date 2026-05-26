import { describe, it, expect } from "vitest";
import { computeWristPlane } from "../wristPlane";
import type { TryOnLandmarks } from "../types";

function makeLandmarks(opts: {
  width?: number;
  height?: number;
  pts: Record<number, { x: number; y: number; z?: number; vis?: number }>;
}): TryOnLandmarks {
  const W = opts.width ?? 1000;
  const H = opts.height ?? 1000;
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [idx, p] of Object.entries(opts.pts)) {
    const i = Number(idx);
    hand[i] = { x: p.x, y: p.y, z: p.z, visibility: p.vis ?? 0.95 };
  }
  return {
    hand,
    face: [],
    pose: [],
    imageWidth: W,
    imageHeight: H,
  } as unknown as TryOnLandmarks;
}

describe("computeWristPlane", () => {
  it("returns a neutral plane (factor=1) when the wrist faces the camera", () => {
    const lm = makeLandmarks({
      pts: {
        0: { x: 0.5, y: 0.6, z: 0 }, // wrist
        1: { x: 0.4, y: 0.55, z: 0 }, // thumb CMC
        5: { x: 0.45, y: 0.35, z: 0 },
        9: { x: 0.5, y: 0.32, z: 0 },
        13: { x: 0.55, y: 0.33, z: 0 },
        17: { x: 0.6, y: 0.4, z: 0 }, // pinky MCP
      },
    });
    const plane = computeWristPlane(lm);
    expect(plane.foreshorteningFactor).toBeCloseTo(1, 1);
    expect(plane.tiltMagnitudeDeg).toBeLessThan(15);
  });

  it("detects a tilted wrist via the z channel and lowers the foreshortening factor", () => {
    // Same landmarks except thumb sits nearer to camera (z=-0.4) and
    // pinky sits farther (z=+0.4). This is a 90° rotation around the
    // forearm axis — plane normal lies in the image plane.
    const lm = makeLandmarks({
      pts: {
        0: { x: 0.5, y: 0.6, z: 0 },
        1: { x: 0.4, y: 0.55, z: -0.4 }, // closer to camera
        5: { x: 0.45, y: 0.35, z: -0.15 },
        9: { x: 0.5, y: 0.32, z: 0 },
        13: { x: 0.55, y: 0.33, z: 0.15 },
        17: { x: 0.6, y: 0.4, z: 0.4 }, // farther from camera
      },
    });
    const plane = computeWristPlane(lm);
    expect(plane.has3DDepth).toBe(true);
    expect(plane.foreshorteningFactor).toBeLessThan(1);
    expect(plane.foreshorteningFactor).toBeGreaterThanOrEqual(0.5);
    expect(plane.tiltMagnitudeDeg).toBeGreaterThan(15);
    expect(Math.abs(plane.yawDeg)).toBeGreaterThan(10);
  });

  it("emits the neutral fallback when landmarks are missing", () => {
    const plane = computeWristPlane(null);
    expect(plane.has3DDepth).toBe(false);
    expect(plane.foreshorteningFactor).toBe(1);
    expect(plane.tiltMagnitudeDeg).toBe(0);
    expect(plane.confidence).toBe(0);
  });

  it("never returns a foreshortening factor below 0.5 (60° clamp)", () => {
    const lm = makeLandmarks({
      pts: {
        0: { x: 0.5, y: 0.6, z: 0 },
        1: { x: 0.4, y: 0.55, z: -10 }, // extreme tilt
        5: { x: 0.45, y: 0.35, z: -3 },
        9: { x: 0.5, y: 0.32, z: 0 },
        13: { x: 0.55, y: 0.33, z: 3 },
        17: { x: 0.6, y: 0.4, z: 10 },
      },
    });
    const plane = computeWristPlane(lm);
    expect(plane.foreshorteningFactor).toBeGreaterThanOrEqual(0.5);
  });
});
