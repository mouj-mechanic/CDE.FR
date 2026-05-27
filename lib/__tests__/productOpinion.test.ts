import { describe, expect, it } from "vitest";
import { generateProductOpinion } from "@/lib/productOpinion";

describe("productOpinion", () => {
  it("returns a category-appropriate phrase for a watch", () => {
    const text = generateProductOpinion({
      category: "watch",
      productTitle: "Rainbow Diver Chrono",
    });
    expect(text.length).toBeGreaterThan(10);
    expect(text.toLowerCase()).toMatch(/montre|boîtier|bracelet|cadran|style|sport/);
  });

  it("returns stable output for the same product title", () => {
    const a = generateProductOpinion({
      category: "watch",
      productTitle: "Rainbow Diver Chrono",
    });
    const b = generateProductOpinion({
      category: "watch",
      productTitle: "Rainbow Diver Chrono",
    });
    expect(a).toBe(b);
  });

  it("appends the fidelity note when a fallback was used", () => {
    const text = generateProductOpinion({
      category: "watch",
      productTitle: "Test",
      fallbackUsed: true,
    });
    expect(text.toLowerCase()).toContain("fidélit");
  });

  it("never makes purchase or body-shape claims", () => {
    const categories = [
      "watch",
      "glasses",
      "clothes",
      "headwear",
      "hand-jewelry",
    ] as const;
    for (const c of categories) {
      const t = generateProductOpinion({ category: c, productTitle: "X" });
      const lower = t.toLowerCase();
      expect(lower).not.toMatch(/(devriez? acheter|achetez|va parfaitement|maigre|gros|silhouette parfaite)/);
    }
  });
});
