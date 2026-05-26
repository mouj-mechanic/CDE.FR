import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  resolveOutputAspectFromSource,
  restoreSourceAspectRatio,
  detectBlackBars,
  computeOutsideMaskScore,
  bwMaskToAlphaPng,
} from "../openaiImage";

const W = 256;
const H = 256;

async function gradient(): Promise<Buffer> {
  // simple horizontal gradient so diffs in localised patches are clear
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const v = Math.floor((x / W) * 255);
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toBuffer();
}

async function withWhitePatch(box: {
  x: number;
  y: number;
  size: number;
}): Promise<Buffer> {
  const base = await gradient();
  return sharp(base)
    .composite([
      {
        input: {
          create: {
            width: box.size,
            height: box.size,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        },
        left: box.x,
        top: box.y,
      },
    ])
    .png()
    .toBuffer();
}

async function fullAlpha(opaqueOuter: boolean): Promise<Buffer> {
  // Alpha mask: 255 = preserved (the WHOLE image counted), but with
  // a small editable hole in the centre (alpha=0) so the comparator
  // doesn't degenerate.
  const raw = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      raw[i] = 0;
      raw[i + 1] = 0;
      raw[i + 2] = 0;
      const inHole =
        x > W / 2 - 8 && x < W / 2 + 8 && y > H / 2 - 8 && y < H / 2 + 8;
      raw[i + 3] = inHole ? 0 : opaqueOuter ? 255 : 128;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
}

async function silhouetteAt(box: {
  x: number;
  y: number;
  size: number;
}): Promise<Buffer> {
  const raw = Buffer.alloc(W * H);
  for (let y = box.y; y < box.y + box.size; y++) {
    for (let x = box.x; x < box.x + box.size; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) {
        raw[y * W + x] = 255;
      }
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
}

describe("resolveOutputAspectFromSource", () => {
  it("returns 1024x1536 for a clearly portrait source", () => {
    const out = resolveOutputAspectFromSource({
      userImageDimensions: { width: 1024, height: 1536 },
      requestedSize: "auto",
    });
    expect(out).toBe("1024x1536");
  });

  it("returns 1536x1024 for a clearly landscape source", () => {
    const out = resolveOutputAspectFromSource({
      userImageDimensions: { width: 1536, height: 1024 },
      requestedSize: "auto",
    });
    expect(out).toBe("1536x1024");
  });

  it("returns 1024x1024 for near-square sources", () => {
    const out = resolveOutputAspectFromSource({
      userImageDimensions: { width: 1024, height: 1024 },
      requestedSize: "auto",
    });
    expect(out).toBe("1024x1024");
  });

  it("auto-promotes 1024x1024 → 1024x1536 for portrait sources", () => {
    const out = resolveOutputAspectFromSource({
      userImageDimensions: { width: 800, height: 1200 },
      requestedSize: "1024x1024",
    });
    expect(out).toBe("1024x1536");
  });

  it("respects 1024x1024-strict even for portrait sources", () => {
    const out = resolveOutputAspectFromSource({
      userImageDimensions: { width: 800, height: 1200 },
      requestedSize: "1024x1024-strict",
    });
    expect(out).toBe("1024x1024");
  });

  it("respects explicit 1024x1536", () => {
    const out = resolveOutputAspectFromSource({
      userImageDimensions: { width: 1024, height: 1024 },
      requestedSize: "1024x1536",
    });
    expect(out).toBe("1024x1536");
  });

  it("prefers compositeDimensions over userImageDimensions", () => {
    const out = resolveOutputAspectFromSource({
      userImageDimensions: { width: 1024, height: 1024 },
      compositeDimensions: { width: 800, height: 1400 },
      requestedSize: "auto",
    });
    expect(out).toBe("1024x1536");
  });
});

describe("detectBlackBars", () => {
  it("flags side bars on a 1024x1024 image with portrait content", async () => {
    // 1024x1024 image with a 768-wide white rectangle centered, leaving
    // 128px black bars on each side.
    const png = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 768,
              height: 1024,
              channels: 3,
              background: { r: 255, g: 255, b: 255 },
            },
          },
          left: 128,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const bars = await detectBlackBars(png);
    expect(bars.left).toBe(true);
    expect(bars.right).toBe(true);
    expect(bars.top).toBe(false);
    expect(bars.bottom).toBe(false);
    expect(bars.any).toBe(true);
  });

  it("does not flag bars on a fully content-filled image", async () => {
    const png = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .png()
      .toBuffer();
    const bars = await detectBlackBars(png);
    expect(bars.any).toBe(false);
  });
});

describe("restoreSourceAspectRatio", () => {
  it("crops side bars off a square output to restore portrait source", async () => {
    // 1024x1024 result with 128px black bars on left/right (768x1024
    // content centered).
    const result = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 768,
              height: 1024,
              channels: 3,
              background: { r: 200, g: 200, b: 200 },
            },
          },
          left: 128,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const cropped = await restoreSourceAspectRatio({
      resultBuffer: result,
      sourceDimensions: { width: 768, height: 1024 },
    });
    const meta = await sharp(cropped).metadata();
    expect(meta.width).toBe(768);
    expect(meta.height).toBe(1024);
  });

  it("returns the input unchanged when source and output match", async () => {
    const result = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .png()
      .toBuffer();
    const out = await restoreSourceAspectRatio({
      resultBuffer: result,
      sourceDimensions: { width: 1024, height: 1024 },
    });
    expect(out.length).toBe(result.length);
  });

  it("crops top/bottom bars off a landscape output for portrait source", async () => {
    // 1536x1024 result; source is 1024x1280 → ratio 0.8 (portrait).
    // We expect crop to roughly 819x1024.
    const result = await sharp({
      create: {
        width: 1536,
        height: 1024,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .png()
      .toBuffer();
    const cropped = await restoreSourceAspectRatio({
      resultBuffer: result,
      sourceDimensions: { width: 1024, height: 1280 },
    });
    const meta = await sharp(cropped).metadata();
    // 1024 * (1024/1280) ≈ 819 (within rounding)
    expect(meta.width).toBe(819);
    expect(meta.height).toBe(1024);
  });
});

describe("bwMaskToAlphaPng — internal BW to OpenAI alpha convention", () => {
  it("converts internal WHITE (editable) into alpha=0 (transparent)", async () => {
    const w = 32;
    const h = 32;
    const bw = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const alpha = await bwMaskToAlphaPng(bw);
    const channels = await sharp(alpha)
      .extractChannel("alpha")
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Every alpha pixel should be near-zero (editable).
    expect(channels.data[0]).toBeLessThan(10);
    expect(channels.data[channels.data.length - 1]).toBeLessThan(10);
  });

  it("converts internal BLACK (preserved) into alpha=255 (opaque)", async () => {
    const w = 32;
    const h = 32;
    const bw = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const alpha = await bwMaskToAlphaPng(bw);
    const channels = await sharp(alpha)
      .extractChannel("alpha")
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(channels.data[0]).toBeGreaterThan(245);
  });

  it("preserves dimensions exactly", async () => {
    const w = 256;
    const h = 384;
    const bw = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer();
    const alpha = await bwMaskToAlphaPng(bw);
    const meta = await sharp(alpha).metadata();
    expect(meta.width).toBe(w);
    expect(meta.height).toBe(h);
  });

  it("RGB channels of the alpha mask are zero (no colour leak)", async () => {
    const w = 16;
    const h = 16;
    const bw = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer();
    const alpha = await bwMaskToAlphaPng(bw);
    const raw = await sharp(alpha)
      .raw()
      .toBuffer({ resolveWithObject: true });
    // RGBA: channels = 4. R/G/B must all be zero so the mask never
    // colours the AI output if it ever got composited by mistake.
    for (let i = 0; i < raw.info.width * raw.info.height; i++) {
      expect(raw.data[i * 4]).toBe(0);
      expect(raw.data[i * 4 + 1]).toBe(0);
      expect(raw.data[i * 4 + 2]).toBe(0);
    }
  });
});

describe("computeOutsideMaskScore — product silhouette + black bars exclusion", () => {
  it("does NOT flag a customer-preservation failure when the change is inside the product silhouette", async () => {
    const base = await gradient();
    // Change the gradient ONLY where the product sits.
    const result = await withWhitePatch({ x: 100, y: 100, size: 40 });
    const alpha = await fullAlpha(true);
    const silhouette = await silhouetteAt({ x: 100, y: 100, size: 40 });

    const withSilhouette = await computeOutsideMaskScore(
      base,
      result,
      alpha,
      { productSilhouette: silhouette, productExpandPx: 32 }
    );
    const without = await computeOutsideMaskScore(base, result, alpha);

    // With silhouette exclusion: most of the "drift" is masked out →
    // higher score → preservation stays true.
    expect(withSilhouette.score).toBeGreaterThan(without.score);
    expect(withSilhouette.excludedPixels).toBeGreaterThan(0);
  });

  it("DOES flag a customer-preservation failure when fingers / background drift", async () => {
    const base = await gradient();
    // Change in a corner FAR from any product silhouette.
    const result = await withWhitePatch({ x: 8, y: 8, size: 60 });
    const alpha = await fullAlpha(true);
    const silhouette = await silhouetteAt({ x: 100, y: 100, size: 40 });

    const check = await computeOutsideMaskScore(base, result, alpha, {
      productSilhouette: silhouette,
      productExpandPx: 24,
    });

    // The 60×60 white patch sits in a region NOT covered by the
    // silhouette, so it must contribute to the diff.
    expect(check.score).toBeLessThan(0.95);
  });

  it("ignores near-black letterbox residue on both sides", async () => {
    // Both base and result share black bars on top/bottom.
    const baseRaw = Buffer.alloc(W * H * 3);
    const resRaw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      const isBar = y < 16 || y >= H - 16;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const v = isBar ? 0 : 200;
        baseRaw[i] = baseRaw[i + 1] = baseRaw[i + 2] = v;
        resRaw[i] = resRaw[i + 1] = resRaw[i + 2] = v;
      }
    }
    const base = await sharp(baseRaw, {
      raw: { width: W, height: H, channels: 3 },
    })
      .png()
      .toBuffer();
    const result = await sharp(resRaw, {
      raw: { width: W, height: H, channels: 3 },
    })
      .png()
      .toBuffer();
    const alpha = await fullAlpha(true);
    const check = await computeOutsideMaskScore(base, result, alpha);
    expect(check.score).toBeGreaterThan(0.98);
    expect(check.excludedPixels).toBeGreaterThan(0);
  });
});
