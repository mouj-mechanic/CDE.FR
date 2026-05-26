import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { checkProductFidelity } from "../productFidelityCheck";

/**
 *  Same idea as the duplicate-detection tests: we synthesise pairs of
 *  images where we know exactly what colour drift / silhouette drift to
 *  expect, then assert on the gate booleans.
 */

const W = 256;
const H = 256;

async function solidGrey(): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

async function withSquare(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .composite([
      {
        input: {
          create: {
            width: 64,
            height: 64,
            channels: 4,
            background: { ...color, alpha: 1 },
          },
        },
        left: 96,
        top: 96,
      },
    ])
    .png()
    .toBuffer();
}

describe("checkProductFidelity", () => {
  it("passes when the composite and AI result agree on colour and size", async () => {
    const userBase = await solidGrey();
    const composite = await withSquare({ r: 20, g: 20, b: 20 }); // black watch
    const aiResult = await withSquare({ r: 22, g: 22, b: 22 });
    const r = await checkProductFidelity({
      aiResult,
      composite,
      userBase,
      category: "watch",
    });
    expect(r.colorOk).toBe(true);
    expect(r.silhouetteRatioOk).toBe(true);
    expect(r.passed).toBe(true);
  });

  it("flags a black→silver watch swap as colour drift", async () => {
    const userBase = await solidGrey();
    const composite = await withSquare({ r: 20, g: 20, b: 20 });
    const aiResult = await withSquare({ r: 220, g: 220, b: 220 });
    const r = await checkProductFidelity({
      aiResult,
      composite,
      userBase,
      category: "watch",
    });
    expect(r.colorOk).toBe(false);
    expect(r.passed).toBe(false);
    expect(r.colorDelta).toBeGreaterThan(38);
  });

  it("uses tighter colour thresholds for watches than for headwear", async () => {
    const userBase = await solidGrey();
    const composite = await withSquare({ r: 20, g: 20, b: 20 });
    // ΔRGB ≈ 50 — over the watch ceiling (38), under the headwear one (55).
    const aiResult = await withSquare({ r: 70, g: 70, b: 70 });

    const watch = await checkProductFidelity({
      aiResult,
      composite,
      userBase,
      category: "watch",
    });
    const headwear = await checkProductFidelity({
      aiResult,
      composite,
      userBase,
      category: "headwear",
    });
    expect(watch.colorOk).toBe(false);
    expect(headwear.colorOk).toBe(true);
  });
});
