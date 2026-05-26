import { describe, it, expect } from "vitest";
import {
  detectWatchProductOrientation,
  getWatchRendererVersion,
} from "../watchRendererV3";

describe("detectWatchProductOrientation", () => {
  it("detects vertical_strap when height > 1.15 × width", () => {
    const out = detectWatchProductOrientation({
      productWidth: 200,
      productHeight: 400,
    });
    expect(out.orientation).toBe("vertical_strap");
    expect(out.productStrapAxisDeg).toBe(90);
    expect(out.confidence).toBeGreaterThan(0.7);
  });

  it("detects horizontal_strap when width > 1.15 × height", () => {
    const out = detectWatchProductOrientation({
      productWidth: 400,
      productHeight: 200,
    });
    expect(out.orientation).toBe("horizontal_strap");
    expect(out.productStrapAxisDeg).toBe(0);
  });

  it("defaults to vertical_strap on square images", () => {
    const out = detectWatchProductOrientation({
      productWidth: 300,
      productHeight: 305,
    });
    expect(out.orientation).toBe("square_uncertain");
    // Default is vertical (the production assumption).
    expect(out.productStrapAxisDeg).toBe(90);
  });

  it("honours PRODUCT_STRAP_AXIS_DEG env override", () => {
    const original = process.env.PRODUCT_STRAP_AXIS_DEG;
    process.env.PRODUCT_STRAP_AXIS_DEG = "45";
    try {
      const out = detectWatchProductOrientation({
        productWidth: 200,
        productHeight: 400,
      });
      // Orientation reflects geometry…
      expect(out.orientation).toBe("vertical_strap");
      // …but the strap axis is overridden by env.
      expect(out.productStrapAxisDeg).toBe(45);
    } finally {
      if (original === undefined) delete process.env.PRODUCT_STRAP_AXIS_DEG;
      else process.env.PRODUCT_STRAP_AXIS_DEG = original;
    }
  });
});

describe("getWatchRendererVersion", () => {
  it("returns v3 by default", () => {
    const original = process.env.WATCH_RENDERER_VERSION;
    delete process.env.WATCH_RENDERER_VERSION;
    delete process.env.NEXT_PUBLIC_WATCH_RENDERER_VERSION;
    try {
      expect(getWatchRendererVersion()).toBe("v3");
    } finally {
      if (original !== undefined) process.env.WATCH_RENDERER_VERSION = original;
    }
  });

  it("returns v2 when explicitly set", () => {
    const original = process.env.WATCH_RENDERER_VERSION;
    process.env.WATCH_RENDERER_VERSION = "v2";
    try {
      expect(getWatchRendererVersion()).toBe("v2");
    } finally {
      if (original === undefined) delete process.env.WATCH_RENDERER_VERSION;
      else process.env.WATCH_RENDERER_VERSION = original;
    }
  });

  it("falls back to v3 on garbage input", () => {
    const original = process.env.WATCH_RENDERER_VERSION;
    process.env.WATCH_RENDERER_VERSION = "garbage";
    try {
      expect(getWatchRendererVersion()).toBe("v3");
    } finally {
      if (original === undefined) delete process.env.WATCH_RENDERER_VERSION;
      else process.env.WATCH_RENDERER_VERSION = original;
    }
  });
});
