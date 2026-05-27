// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  generateJobId,
  postAddToCart,
  postJobStarted,
  postMinimize,
  postRestore,
} from "@/lib/embedMessaging";

describe("embedMessaging", () => {
  let originalParent: Window | null = null;
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalParent = window.parent;
    postMessageSpy = vi.fn();
    Object.defineProperty(window, "parent", {
      configurable: true,
      get() {
        return {
          postMessage: postMessageSpy,
        };
      },
    });
  });

  afterEach(() => {
    if (originalParent) {
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: originalParent,
      });
    }
  });

  it("generates unique job ids", () => {
    const a = generateJobId();
    const b = generateJobId();
    expect(a).not.toEqual(b);
    expect(a.startsWith("job_")).toBe(true);
  });

  it("posts JOB_STARTED with source=trywithai", () => {
    postJobStarted({
      jobId: "job_test",
      category: "watch",
      message: "Je prépare votre simulation IA…",
    });
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const [arg] = postMessageSpy.mock.calls[0];
    expect(arg.type).toBe("TRYWITHAI_JOB_STARTED");
    expect(arg.source).toBe("trywithai");
    expect(arg.payload.jobId).toBe("job_test");
  });

  it("posts MINIMIZE / RESTORE without a payload", () => {
    postMinimize();
    postRestore();
    expect(postMessageSpy).toHaveBeenCalledTimes(2);
    expect(postMessageSpy.mock.calls[0][0].type).toBe("TRYWITHAI_MINIMIZE");
    expect(postMessageSpy.mock.calls[1][0].type).toBe("TRYWITHAI_RESTORE");
  });

  it("forwards ADD_TO_CART payload", () => {
    postAddToCart({
      jobId: "job_x",
      productTitle: "Watch",
      resultUrl: "https://x/y",
    });
    const arg = postMessageSpy.mock.calls[0][0];
    expect(arg.type).toBe("TRYWITHAI_ADD_TO_CART");
    expect(arg.payload.productTitle).toBe("Watch");
  });
});
