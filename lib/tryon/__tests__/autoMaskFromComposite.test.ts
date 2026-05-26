import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { autoMaskFromComposite } from "../autoMaskFromComposite";

const W = 512;
const H = 512;

async function solidGrey(): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

async function withProductSquare(): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .composite([
      {
        input: {
          create: {
            width: 80,
            height: 80,
            channels: 4,
            background: { r: 10, g: 10, b: 10, alpha: 1 },
          },
        },
        left: 216,
        top: 216,
      },
    ])
    .png()
    .toBuffer();
}

describe("autoMaskFromComposite — watch ring mask", () => {
  it("returns a ring mask with coverage well below 12% for watch", async () => {
    const userBase = await solidGrey();
    const composite = await withProductSquare();
    const result = await autoMaskFromComposite({
      userImage: userBase,
      compositeImage: composite,
      targetWidth: W,
      targetHeight: H,
      category: "watch",
    });
    expect(result).not.toBeNull();
    expect(result!.coverage).toBeLessThan(0.12);
    expect(result!.coverage).toBeGreaterThan(0.001);
  });

  it("ring mask coverage is smaller than full-silhouette mask for the same input", async () => {
    const userBase = await solidGrey();
    const composite = await withProductSquare();
    const ring = await autoMaskFromComposite({
      userImage: userBase,
      compositeImage: composite,
      targetWidth: W,
      targetHeight: H,
      category: "watch",
    });
    const full = await autoMaskFromComposite({
      userImage: userBase,
      compositeImage: composite,
      targetWidth: W,
      targetHeight: H,
      category: "clothes",
    });
    expect(ring).not.toBeNull();
    expect(full).not.toBeNull();
    expect(ring!.coverage).toBeLessThan(full!.coverage);
  });
});
