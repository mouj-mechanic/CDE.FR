import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  resolveOutputAspectFromSource,
  restoreSourceAspectRatio,
  detectBlackBars,
} from "../openaiImage";

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
