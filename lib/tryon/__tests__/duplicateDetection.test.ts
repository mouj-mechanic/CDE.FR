import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { detectDuplicateProductPlacement } from "../duplicateDetection";

/**
 *  We feed the detector synthetic images so the test never depends on
 *  real AI output:
 *
 *    - userBase   : a solid-grey 256×256 image (no product)
 *    - aiResult   : a copy of userBase with N black squares painted on top
 *
 *  The connected-components flood-fill should report N components,
 *  and `duplicateDetected` should be true when N ≥ 2.
 */

const W = 256;
const H = 256;

async function solidGrey(): Promise<Buffer> {
  return sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 180, g: 180, b: 180 },
    },
  })
    .png()
    .toBuffer();
}

async function withSquares(squares: Array<{ x: number; y: number; size: number }>): Promise<Buffer> {
  // Compose all squares as black overlays.
  const overlays = squares.map((s) => ({
    input: {
      create: {
        width: s.size,
        height: s.size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    } as sharp.CreateRaw,
    left: s.x,
    top: s.y,
  }));
  return sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 180, g: 180, b: 180 },
    },
  })
    .composite(overlays.map((o) => ({ input: o.input, left: o.left, top: o.top })))
    .png()
    .toBuffer();
}

describe("detectDuplicateProductPlacement", () => {
  it("returns no duplication for a single product region", async () => {
    const base = await solidGrey();
    const ai = await withSquares([{ x: 100, y: 100, size: 50 }]);
    // 50×50 / (256×256) ≈ 0.038 of the image is the expected silhouette.
    const result = await detectDuplicateProductPlacement({
      aiResult: ai,
      userBase: base,
      expectedSilhouetteRatio: 0.038,
      category: "watch",
    });
    expect(result.duplicateDetected).toBe(false);
    expect(result.componentCount).toBe(1);
  });

  it("flags two separate squares as duplication for watch", async () => {
    const base = await solidGrey();
    const ai = await withSquares([
      { x: 30, y: 30, size: 50 },
      { x: 170, y: 170, size: 50 },
    ]);
    const result = await detectDuplicateProductPlacement({
      aiResult: ai,
      userBase: base,
      expectedSilhouetteRatio: 0.038,
      category: "watch",
    });
    expect(result.duplicateDetected).toBe(true);
    expect(result.componentCount).toBeGreaterThanOrEqual(2);
    expect(result.reason).toMatch(/product-sized regions/i);
  });

  it("does not flag duplication when the second region is too small", async () => {
    const base = await solidGrey();
    const ai = await withSquares([
      { x: 30, y: 30, size: 50 },
      { x: 200, y: 200, size: 8 }, // far too small to count
    ]);
    const result = await detectDuplicateProductPlacement({
      aiResult: ai,
      userBase: base,
      expectedSilhouetteRatio: 0.038,
      category: "watch",
    });
    expect(result.duplicateDetected).toBe(false);
  });

  it("never flags duplication for clothes", async () => {
    const base = await solidGrey();
    const ai = await withSquares([
      { x: 30, y: 30, size: 50 },
      { x: 170, y: 170, size: 50 },
    ]);
    const result = await detectDuplicateProductPlacement({
      aiResult: ai,
      userBase: base,
      expectedSilhouetteRatio: 0.2,
      category: "clothes",
    });
    expect(result.duplicateDetected).toBe(false);
    expect(result.reason).toMatch(/clothes/i);
  });

  it("safely handles tiny expected silhouettes (no false positives)", async () => {
    const base = await solidGrey();
    const ai = await withSquares([{ x: 100, y: 100, size: 4 }]);
    const result = await detectDuplicateProductPlacement({
      aiResult: ai,
      userBase: base,
      expectedSilhouetteRatio: 0.0001,
      category: "watch",
    });
    expect(result.duplicateDetected).toBe(false);
  });
});
