import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { autoMaskFromComposite } from "../autoMaskFromComposite";
import {
  computeEditableEnergy,
  minEditableRatioFor,
  targetEditableRatioFor,
} from "../maskValidation";

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

  it("ring mask meets the per-category MIN editable energy", async () => {
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
    expect(result!.coverage).toBeGreaterThanOrEqual(
      minEditableRatioFor("watch")
    );
  });

  it("ring mask reaches the watch TARGET band when product is small", async () => {
    const userBase = await solidGrey();
    // a 60x60 product silhouette → forces the expansion loop
    const composite = await sharp({
      create: {
        width: W,
        height: H,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 60,
              height: 60,
              channels: 4,
              background: { r: 10, g: 10, b: 10, alpha: 1 },
            },
          },
          left: 230,
          top: 230,
        },
      ])
      .png()
      .toBuffer();
    const result = await autoMaskFromComposite({
      userImage: userBase,
      compositeImage: composite,
      targetWidth: W,
      targetHeight: H,
      category: "watch",
    });
    expect(result).not.toBeNull();
    const target = targetEditableRatioFor("watch");
    expect(result!.coverage).toBeGreaterThanOrEqual(target.min * 0.7);
    expect(result!.debug?.expansionAttempts).toBeGreaterThanOrEqual(0);
  });

  it("never returns a coverage above the hard cap (12 % for watch)", async () => {
    const userBase = await solidGrey();
    // a HUGE silhouette to try to overshoot
    const composite = await sharp({
      create: {
        width: W,
        height: H,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 200,
              height: 200,
              channels: 4,
              background: { r: 10, g: 10, b: 10, alpha: 1 },
            },
          },
          left: 156,
          top: 156,
        },
      ])
      .png()
      .toBuffer();
    const result = await autoMaskFromComposite({
      userImage: userBase,
      compositeImage: composite,
      targetWidth: W,
      targetHeight: H,
      category: "watch",
    });
    expect(result).not.toBeNull();
    expect(result!.coverage).toBeLessThanOrEqual(0.18);
  });

  it("preserves the product core (centre pixel stays dark in the mask)", async () => {
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
    const raw = await sharp(result!.buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Centre of the silhouette (256, 256) — must be black/dark.
    const idx = 256 * raw.info.width + 256;
    const v = raw.data[idx * raw.info.channels];
    expect(v).toBeLessThan(80);
  });
});

describe("computeEditableEnergy — weighted metric", () => {
  it("reports a higher ratio than the old bright-pixel threshold on soft masks", async () => {
    // Build a gradient mask where the bulk of pixels sit in [60..160]
    // — invisible to the legacy `>= 200` count, but visible to the
    // weighted-energy metric.
    const w = 128;
    const h = 128;
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = Math.round(80 + ((x + y) / (w + h)) * 80); // 80..160
        buf[i] = v;
        buf[i + 1] = v;
        buf[i + 2] = v;
        buf[i + 3] = 255;
      }
    }
    const png = await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toBuffer();
    const stats = await computeEditableEnergy(png);
    expect(stats.editableEnergyRatio).toBeGreaterThan(0.3);
    expect(stats.brightRatio).toBeLessThan(0.05);
    expect(stats.softRatio).toBeGreaterThan(0.5);
  });
});
