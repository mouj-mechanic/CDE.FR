import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { checkWatchMaskSafety } from "../maskSafetyCheck";

const W = 512;
const H = 768;

async function blackImage(): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

async function whiteRectangle(
  x: number,
  y: number,
  w: number,
  h: number
): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: w,
            height: h,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
          },
        },
        left: x,
        top: y,
      },
    ])
    .png()
    .toBuffer();
}

describe("checkWatchMaskSafety — production guards", () => {
  it("passes a small editable ring centered on a realistic wrist", async () => {
    const mask = await whiteRectangle(220, 360, 80, 60);
    const safety = await checkWatchMaskSafety({ mask, category: "watch" });
    expect(safety.ok).toBe(true);
    expect(safety.reasons).toHaveLength(0);
    expect(safety.stats.inverted).toBe(false);
  });

  it("BLOCKS an inverted mask (editable area > 50% of image)", async () => {
    const mask = await sharp({
      create: {
        width: W,
        height: H,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 40,
              height: 40,
              channels: 3,
              background: { r: 0, g: 0, b: 0 },
            },
          },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const safety = await checkWatchMaskSafety({ mask, category: "watch" });
    expect(safety.ok).toBe(false);
    expect(safety.reasons).toContain("mask_probably_inverted");
  });

  it("BLOCKS a mask whose bbox covers > 14% of the image (hand-area takeover)", async () => {
    // 0.5 × 0.4 = 0.20 → 20 % bbox area, well past the watch cap
    const mask = await whiteRectangle(50, 60, 256, 308);
    const safety = await checkWatchMaskSafety({ mask, category: "watch" });
    expect(safety.ok).toBe(false);
    expect(safety.reasons).toContain("mask_bbox_covers_too_much_hand");
  });

  it("BLOCKS a mask that touches the image border", async () => {
    const mask = await whiteRectangle(0, 360, 100, 60);
    const safety = await checkWatchMaskSafety({ mask, category: "watch" });
    expect(safety.ok).toBe(false);
    expect(safety.reasons).toContain("mask_touches_image_border");
  });

  it("BLOCKS a mask whose energy falls outside the expected product zone", async () => {
    // Mask placed in the top-left corner, but bbox says product is
    // bottom-right — most energy is outside.
    const mask = await whiteRectangle(10, 10, 80, 60);
    const safety = await checkWatchMaskSafety({
      mask,
      category: "watch",
      productBBox: { x0: 0.7, y0: 0.7, x1: 0.9, y1: 0.85 },
    });
    expect(safety.ok).toBe(false);
    expect(safety.reasons).toContain("mask_energy_outside_product_zone");
  });

  it("passes a black (empty) mask without crashing", async () => {
    const mask = await blackImage();
    const safety = await checkWatchMaskSafety({ mask, category: "watch" });
    expect(safety.stats.editableEnergyRatio).toBe(0);
    expect(safety.stats.bbox.ratio).toBe(0);
  });
});
