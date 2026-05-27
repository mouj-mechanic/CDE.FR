import { describe, expect, it } from "vitest";
import { initialTryOnState, tryOnReducer } from "@/lib/tryOnReducer";
import type { ProductItem, TryOnState } from "@/types";

function makeState(overrides: Partial<TryOnState> = {}): TryOnState {
  return { ...initialTryOnState, ...overrides };
}

describe("tryOnReducer — RESET_PRODUCT_KEEP_PHOTO", () => {
  it("clears products + result but preserves user photo and notes", () => {
    const fakeFile = new File([new Uint8Array([1, 2, 3])], "u.jpg", {
      type: "image/jpeg",
    });
    const product: ProductItem = {
      id: "p1",
      type: "url",
      value: "https://example.com/x.jpg",
    };
    const state = makeState({
      step: 3,
      userImage: fakeFile,
      userImagePreview: "blob:fake",
      notes: "keep me",
      products: [product],
      status: "done",
      resultUrl: "https://example.com/r.png",
      resultMeta: { provider: "openai" },
    });

    const next = tryOnReducer(state, { type: "RESET_PRODUCT_KEEP_PHOTO" });

    expect(next.userImage).toBe(fakeFile);
    expect(next.userImagePreview).toBe("blob:fake");
    expect(next.notes).toBe("keep me");
    expect(next.products).toEqual([]);
    expect(next.resultUrl).toBeNull();
    expect(next.resultMeta).toBeNull();
    expect(next.status).toBe("idle");
    expect(next.step).toBe(3);
  });
});
