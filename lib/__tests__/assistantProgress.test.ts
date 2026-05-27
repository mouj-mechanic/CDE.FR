import { describe, expect, it } from "vitest";
import {
  createAssistantTimeline,
  mapTryOnStageToMessage,
} from "@/lib/assistantProgress";

describe("assistantProgress", () => {
  it("returns a monotonically increasing timeline that ends below 100", () => {
    const tl = createAssistantTimeline("watch");
    expect(tl.length).toBeGreaterThan(3);
    let prev = 0;
    for (const stage of tl) {
      expect(stage.endProgress).toBeGreaterThan(prev);
      expect(stage.endProgress).toBeLessThanOrEqual(95);
      prev = stage.endProgress;
    }
    expect(prev).toBeLessThan(100);
  });

  it("ends at exactly 92% (server response snaps to 100)", () => {
    const tl = createAssistantTimeline("watch");
    expect(tl[tl.length - 1].endProgress).toBe(92);
  });

  it("maps each status to a customer-friendly message (no jargon)", () => {
    const statuses = [
      "preparing",
      "analyzing_photo",
      "preparing_product",
      "placing_product",
      "generating",
      "quality_check",
      "ready",
      "fallback_ready",
      "error",
    ] as const;
    for (const s of statuses) {
      const msg = mapTryOnStageToMessage(s);
      expect(msg.length).toBeGreaterThan(0);
      const lower = msg.toLowerCase();
      // Guardrails: no technical leakage.
      expect(lower).not.toMatch(/mask|openai|fal\.ai|provider|stack|http/);
    }
  });
});
