import { describe, it, expect } from "vitest";
import {
  buildCameraConstraintsCascade,
  cameraErrorMessageFromName,
  detectCameraCapability,
} from "../constraints";

describe("buildCameraConstraintsCascade", () => {
  it("never starts with facingMode: exact (iOS Safari compatibility)", () => {
    const cascade = buildCameraConstraintsCascade("environment");
    const first = cascade[0].video;
    if (typeof first === "object" && first && "facingMode" in first) {
      const fm = first.facingMode as { ideal?: string; exact?: string };
      expect(fm.exact).toBeUndefined();
      expect(fm.ideal).toBe("environment");
    } else {
      throw new Error("first constraint should target a facingMode");
    }
  });

  it("degrades down to { video: true } as a last resort", () => {
    const cascade = buildCameraConstraintsCascade("user");
    const last = cascade[cascade.length - 1];
    expect(last.video).toBe(true);
    expect(last.audio).toBe(false);
  });

  it("orders constraints from most-specific to least-specific", () => {
    const cascade = buildCameraConstraintsCascade("environment");
    expect(cascade.length).toBe(3);
    // 1st: facingMode + resolution
    expect(typeof cascade[0].video).toBe("object");
    // 2nd: facingMode only
    expect(typeof cascade[1].video).toBe("object");
    // 3rd: video true
    expect(cascade[2].video).toBe(true);
  });
});

describe("cameraErrorMessageFromName", () => {
  it("returns a friendly permission-denied message for NotAllowedError", () => {
    const msg = cameraErrorMessageFromName("NotAllowedError");
    expect(msg.toLowerCase()).toContain("autoris");
    expect(msg).not.toMatch(/NotAllowed|Error|stack/i);
  });

  it("returns the no-camera-detected message for NotFoundError", () => {
    const msg = cameraErrorMessageFromName("NotFoundError");
    expect(msg.toLowerCase()).toContain("aucune caméra");
  });

  it("falls back to a generic friendly message for unknown errors", () => {
    const msg = cameraErrorMessageFromName("WeirdRandomError");
    expect(msg).toMatch(/importez/i);
    expect(msg).not.toMatch(/WeirdRandomError/);
  });
});

describe("detectCameraCapability", () => {
  it("returns 'insecure' when not in a secure context (http://)", () => {
    const status = detectCameraCapability({
      isSecureContext: false,
      hasMediaDevices: true,
      hasGetUserMedia: true,
    });
    expect(status).toBe("insecure");
  });

  it("returns 'unsupported' when navigator.mediaDevices is missing", () => {
    const status = detectCameraCapability({
      isSecureContext: true,
      hasMediaDevices: false,
      hasGetUserMedia: false,
    });
    expect(status).toBe("unsupported");
  });

  it("returns 'ok' when secure context and getUserMedia exist", () => {
    const status = detectCameraCapability({
      isSecureContext: true,
      hasMediaDevices: true,
      hasGetUserMedia: true,
    });
    expect(status).toBe("ok");
  });
});
