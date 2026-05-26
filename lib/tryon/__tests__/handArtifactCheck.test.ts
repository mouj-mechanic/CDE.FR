import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  checkHandArtifactDamage,
  checkVisibleMaskArtifacts,
} from "../handArtifactCheck";

const W = 256;
const H = 256;

async function gradient(): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const v = Math.floor((x / W) * 200 + 30); // 30..230
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toBuffer();
}

async function pasteWhiteOutline(): Promise<Buffer> {
  // Heavy thin white outline across a wide horizontal band — mimics
  // a mask contour leaking into the final image.
  const base = await gradient();
  const overlayRaw = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const onLine =
        (y === 120 || y === 121 || y === 122) && x > 32 && x < 200;
      overlayRaw[i] = 255;
      overlayRaw[i + 1] = 255;
      overlayRaw[i + 2] = 255;
      overlayRaw[i + 3] = onLine ? 255 : 0;
    }
  }
  const overlay = await sharp(overlayRaw, {
    raw: { width: W, height: H, channels: 4 },
  })
    .png()
    .toBuffer();
  return sharp(base)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function destroyedHand(): Promise<Buffer> {
  // Replace a big chunk of the image with very different colours
  // — simulates the AI destroying fingers / nails.
  const base = await gradient();
  return sharp(base)
    .composite([
      {
        input: {
          create: {
            width: 90,
            height: 90,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
          },
        },
        left: 50,
        top: 50,
      },
    ])
    .png()
    .toBuffer();
}

describe("checkHandArtifactDamage", () => {
  it("passes when the final image equals the user base", async () => {
    const base = await gradient();
    const out = await checkHandArtifactDamage({
      userBase: base,
      finalImage: base,
    });
    expect(out.drift).toBeLessThan(0.001);
    expect(out.isDamaged).toBe(false);
  });

  it("flags a destroyed-hand result (large RGB diff outside the mask)", async () => {
    const base = await gradient();
    const broken = await destroyedHand();
    const out = await checkHandArtifactDamage({
      userBase: base,
      finalImage: broken,
    });
    expect(out.isDamaged).toBe(true);
    expect(out.reason).toBe("hand_artifacts_detected");
  });
});

describe("checkHandArtifactDamage — env threshold override", () => {
  it("honours WATCH_HAND_ARTIFACT_THRESHOLD when set", async () => {
    const base = await gradient();
    const broken = await destroyedHand();
    const original = process.env.WATCH_HAND_ARTIFACT_THRESHOLD;
    process.env.WATCH_HAND_ARTIFACT_THRESHOLD = "0.9";
    try {
      const out = await checkHandArtifactDamage({
        userBase: base,
        finalImage: broken,
      });
      // With a 90 % threshold the damaged image must NOT be flagged.
      expect(out.isDamaged).toBe(false);
    } finally {
      if (original === undefined) delete process.env.WATCH_HAND_ARTIFACT_THRESHOLD;
      else process.env.WATCH_HAND_ARTIFACT_THRESHOLD = original;
    }
  });
});

describe("checkVisibleMaskArtifacts", () => {
  it("passes a clean image with no mask outline", async () => {
    const base = await gradient();
    const out = await checkVisibleMaskArtifacts({
      userBase: base,
      finalImage: base,
    });
    expect(out.visible).toBe(false);
    expect(out.outlinePixelRatio).toBeLessThan(0.004);
  });

  it("flags a final image with a long thin pure-white outline", async () => {
    const base = await gradient();
    const dirty = await pasteWhiteOutline();
    const out = await checkVisibleMaskArtifacts({
      userBase: base,
      finalImage: dirty,
    });
    expect(out.visible).toBe(true);
    expect(out.reason).toBe("visible_mask_artifacts");
  });
});
