import { describe, expect, it } from "vitest";
import { buildShareLink } from "@/lib/shareLinks";

const bundle = {
  url: "https://trywithai.app/r/abc123",
  text: "Mon essayage",
  title: "Mon essayage virtuel",
};

describe("shareLinks", () => {
  it("builds a WhatsApp wa.me link with combined text+url", () => {
    const link = buildShareLink("whatsapp", bundle);
    expect(link.href).toContain("https://wa.me/?text=");
    expect(link.href).toContain(encodeURIComponent(bundle.url));
    expect(link.href).toContain(encodeURIComponent(bundle.text));
    expect(link.newTab).toBe(true);
  });

  it("builds a Viber deep-link", () => {
    const link = buildShareLink("viber", bundle);
    expect(link.href?.startsWith("viber://forward?text=")).toBe(true);
  });

  it("falls back to Facebook share dialog for Messenger (no app id needed)", () => {
    const link = buildShareLink("messenger", bundle);
    expect(link.href).toContain("facebook.com/sharer");
    expect(link.href).toContain(encodeURIComponent(bundle.url));
  });

  it("builds a mailto link", () => {
    const link = buildShareLink("email", bundle);
    expect(link.href?.startsWith("mailto:?subject=")).toBe(true);
    expect(link.href).toContain(encodeURIComponent(bundle.title));
  });

  it("flags Instagram as native-share preferred (no public URL scheme)", () => {
    const link = buildShareLink("instagram", bundle);
    expect(link.href).toBeNull();
    expect(link.preferNative).toBe(true);
  });

  it("flags native as native-share preferred", () => {
    const link = buildShareLink("native", bundle);
    expect(link.preferNative).toBe(true);
  });

  it("returns null href for copy intent", () => {
    const link = buildShareLink("copy", bundle);
    expect(link.href).toBeNull();
  });
});
