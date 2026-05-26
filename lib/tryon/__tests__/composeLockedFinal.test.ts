import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  composeLockedAccessoryFinal,
  detectGhostProductOutsideExpectedSilhouette,
} from "../composeLockedFinal";

const W = 256;
const H = 256;

async function solidGrey(): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

async function withSquares(
  squares: Array<{ x: number; y: number; size: number; color: { r: number; g: number; b: number } }>
): Promise<Buffer> {
  const overlays = squares.map((s) => ({
    input: {
      create: {
        width: s.size,
        height: s.size,
        channels: 4,
        background: { ...s.color, alpha: 1 },
      },
    } as sharp.CreateRaw,
    left: s.x,
    top: s.y,
  }));
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .composite(overlays.map((o) => ({ input: o.input, left: o.left, top: o.top })))
    .png()
    .toBuffer();
}

describe("detectGhostProductOutsideExpectedSilhouette", () => {
  it("reports no ghost when the AI silhouette matches the composite", async () => {
    const userBase = await solidGrey();
    const composite = await withSquares([
      { x: 96, y: 96, size: 64, color: { r: 20, g: 20, b: 20 } },
    ]);
    const aiResult = await withSquares([
      { x: 96, y: 96, size: 64, color: { r: 25, g: 25, b: 25 } },
    ]);
    const r = await detectGhostProductOutsideExpectedSilhouette({
      userBase,
      deterministicComposite: composite,
      aiResult,
    });
    expect(r.ghostDetected).toBe(false);
  });

  it("flags a ghost when the AI drew a second product elsewhere", async () => {
    const userBase = await solidGrey();
    const composite = await withSquares([
      { x: 30, y: 30, size: 60, color: { r: 20, g: 20, b: 20 } },
    ]);
    const aiResult = await withSquares([
      { x: 30, y: 30, size: 60, color: { r: 25, g: 25, b: 25 } },
      { x: 170, y: 170, size: 60, color: { r: 25, g: 25, b: 25 } },
    ]);
    const r = await detectGhostProductOutsideExpectedSilhouette({
      userBase,
      deterministicComposite: composite,
      aiResult,
    });
    expect(r.ghostDetected).toBe(true);
    expect(r.ghostRatio).toBeGreaterThan(0.005);
  });
});

describe("composeLockedAccessoryFinal", () => {
  it("kills a ghost by routing ghost pixels back to the user base", async () => {
    const userBase = await solidGrey();
    const composite = await withSquares([
      { x: 30, y: 30, size: 60, color: { r: 20, g: 20, b: 20 } },
    ]);
    // AI drew the real product + a ghost square far away.
    const aiResult = await withSquares([
      { x: 30, y: 30, size: 60, color: { r: 25, g: 25, b: 25 } },
      { x: 170, y: 170, size: 60, color: { r: 25, g: 25, b: 25 } },
    ]);
    const r = await composeLockedAccessoryFinal({
      userBase,
      deterministicComposite: composite,
      aiResult,
      category: "watch",
    });
    expect(r.applied).toBe(true);
    expect(r.productCoreRatio).toBeGreaterThan(0.01);
    // Sample the ghost area of the final buffer: it must look like
    // userBase (grey 200) again, not the AI dark square.
    const { data, info } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    // Pick a pixel deep inside the original ghost area (200, 200).
    const idx = (200 * info.width + 200) * ch;
    const r0 = data[idx];
    const g0 = data[idx + 1];
    const b0 = data[idx + 2];
    expect(r0).toBeGreaterThan(180);
    expect(g0).toBeGreaterThan(180);
    expect(b0).toBeGreaterThan(180);
  });

  it("preserves the deterministic product pixels in the core region", async () => {
    const userBase = await solidGrey();
    const composite = await withSquares([
      { x: 96, y: 96, size: 64, color: { r: 10, g: 10, b: 10 } },
    ]);
    // AI tried to repaint the product as silver.
    const aiResult = await withSquares([
      { x: 96, y: 96, size: 64, color: { r: 230, g: 230, b: 230 } },
    ]);
    const r = await composeLockedAccessoryFinal({
      userBase,
      deterministicComposite: composite,
      aiResult,
      category: "watch",
    });
    expect(r.applied).toBe(true);
    // Sample the product core. Must stay dark (composite colour), not
    // silver (AI colour).
    const { data, info } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const idx = (128 * info.width + 128) * ch;
    expect(data[idx]).toBeLessThan(40);
  });

  it("skips compositing for clothes", async () => {
    const userBase = await solidGrey();
    const composite = await withSquares([
      { x: 30, y: 30, size: 60, color: { r: 20, g: 20, b: 20 } },
    ]);
    const aiResult = await withSquares([
      { x: 30, y: 30, size: 60, color: { r: 30, g: 30, b: 30 } },
    ]);
    const r = await composeLockedAccessoryFinal({
      userBase,
      deterministicComposite: composite,
      aiResult,
      category: "clothes",
    });
    expect(r.applied).toBe(false);
  });
});
