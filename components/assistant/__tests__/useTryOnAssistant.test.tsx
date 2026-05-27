// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TryOnAssistantMessage, TryOnAssistantState } from "@/types";
import {
  INITIAL,
  STORAGE_KEY,
  clearSessionStorage,
  loadFromSession,
  reducer,
  saveToSession,
} from "../useTryOnAssistant";

function makeMessage(text: string): TryOnAssistantMessage {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    text,
    kind: "info",
    createdAt: Date.now(),
  };
}

describe("assistant reducer — conversation history is preserved", () => {
  it("BOOT does not wipe an existing conversation", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      messages: [makeMessage("hello"), makeMessage("there")],
      category: "watch",
      productImage: "https://example.com/A.jpg",
    };

    const next = reducer(seeded, {
      type: "BOOT",
      category: "watch",
      productImage: "https://example.com/A.jpg",
    });

    expect(next.active).toBe(true);
    expect(next.messages).toHaveLength(2);
  });

  it("BOOT for a DIFFERENT product clears the prior result but keeps messages", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      status: "ready",
      progress: 100,
      messages: [makeMessage("opinion about A")],
      category: "watch",
      productImage: "https://example.com/A.jpg",
      resultUrl: "https://cdn.example.com/A.png",
    };

    const next = reducer(seeded, {
      type: "BOOT",
      category: "glasses",
      productImage: "https://example.com/B.jpg",
    });

    expect(next.resultUrl).toBeUndefined();
    expect(next.status).toBe("idle");
    expect(next.progress).toBe(0);
    expect(next.messages).toHaveLength(1);
    expect(next.category).toBe("glasses");
    expect(next.productImage).toBe("https://example.com/B.jpg");
  });

  it("BOOT for the SAME product preserves the result", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      status: "ready",
      progress: 100,
      messages: [makeMessage("opinion")],
      productImage: "https://example.com/A.jpg",
      resultUrl: "https://cdn.example.com/A.png",
    };

    const next = reducer(seeded, {
      type: "BOOT",
      category: "watch",
      productImage: "https://example.com/A.jpg",
    });

    expect(next.resultUrl).toBe("https://cdn.example.com/A.png");
    expect(next.status).toBe("ready");
  });

  it("START pushes a pending history entry and preserves prior chat messages", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      messages: [makeMessage("earlier turn")],
    };

    const next = reducer(seeded, {
      type: "START",
      jobId: "job_1",
      category: "watch",
      message: "Je prépare votre simulation IA…",
    });

    // No new chat bubbles (the sim panel lives inside the entry now).
    expect(next.messages.length).toBe(1);
    expect(next.messages[0].text).toBe("earlier turn");
    expect(next.status).toBe("preparing");
    // …but a pending entry has been pushed onto the history feed.
    expect(next.history).toHaveLength(1);
    expect(next.history[0].status).toBe("pending");
    expect(next.history[0].jobId).toBe("job_1");
  });

  it("NEW_TRY clears the result and adds a separator without wiping history", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      status: "ready",
      messages: [
        makeMessage("Hello"),
        makeMessage("Result is ready"),
      ],
      resultUrl: "https://cdn.example.com/r.png",
      jobId: "job_old",
    };

    const next = reducer(seeded, { type: "NEW_TRY" });

    expect(next.resultUrl).toBeUndefined();
    expect(next.status).toBe("idle");
    expect(next.jobId).toBeUndefined();
    // Original messages preserved + a new separator appended.
    expect(next.messages.length).toBe(3);
    expect(next.messages[0].text).toBe("Hello");
  });

  it("HYDRATE resets a stale in-flight job to idle but keeps messages", () => {
    const stale: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      status: "generating",
      progress: 56,
      messages: [makeMessage("On y est presque…")],
      category: "watch",
    };

    const next = reducer(INITIAL, { type: "HYDRATE", state: stale });

    expect(next.messages).toHaveLength(1);
    expect(next.status).toBe("idle");
    expect(next.progress).toBe(0);
  });

  it("RESET wipes everything", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      messages: [makeMessage("x"), makeMessage("y")],
      resultUrl: "https://cdn.example.com/r.png",
    };

    const next = reducer(seeded, { type: "RESET" });

    expect(next.active).toBe(false);
    expect(next.messages).toHaveLength(0);
    expect(next.resultUrl).toBeUndefined();
    expect(next.history).toHaveLength(0);
  });
});

describe("assistant reducer — try-on history across PDPs", () => {
  it("READY appends a new history entry with product context", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      jobId: "job_1",
      category: "watch",
      productTitle: "Rolex GMT",
      productImage: "https://example.com/rolex.jpg",
      status: "generating",
    };

    const next = reducer(seeded, {
      type: "READY",
      resultUrl: "https://cdn.example.com/r1.png",
      opinion: "Très lisible et raffinée.",
      shareUrl: "https://share.example.com/1",
    });

    expect(next.history).toHaveLength(1);
    expect(next.history[0].resultUrl).toBe("https://cdn.example.com/r1.png");
    expect(next.history[0].productTitle).toBe("Rolex GMT");
    expect(next.history[0].productImage).toBe("https://example.com/rolex.jpg");
    expect(next.history[0].category).toBe("watch");
    expect(next.history[0].opinion).toBe("Très lisible et raffinée.");
    expect(next.history[0].cartStatus).toBe("idle");
  });

  it("BOOT to a different product preserves the previous history cards", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      productUrl: "https://shop.com/A",
      productImage: "https://shop.com/A.jpg",
      history: [
        {
          id: "entry_A",
          jobId: "job_A",
          category: "watch",
          productTitle: "Watch A",
          productImage: "https://shop.com/A.jpg",
          status: "ready",
          progress: 100,
          resultUrl: "https://cdn.example.com/A.png",
          opinion: "A is great",
          cartStatus: "idle",
          createdAt: 1000,
        },
      ],
    };

    const next = reducer(seeded, {
      type: "BOOT",
      category: "glasses",
      productUrl: "https://shop.com/B",
      productImage: "https://shop.com/B.jpg",
    });

    // History remains intact across PDPs.
    expect(next.history).toHaveLength(1);
    expect(next.history[0].productTitle).toBe("Watch A");
    // Current PDP context is updated.
    expect(next.productImage).toBe("https://shop.com/B.jpg");
    expect(next.status).toBe("idle");
  });

  it("Two consecutive try-ons appear as two cards (oldest first)", () => {
    let state: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      category: "watch",
      productTitle: "Watch A",
      productImage: "https://shop.com/A.jpg",
      jobId: "job_A",
    };

    state = reducer(state, {
      type: "READY",
      resultUrl: "https://cdn.example.com/A.png",
      opinion: "A!",
    });

    // Switch to a different product and finish a 2nd try-on.
    state = reducer(state, {
      type: "BOOT",
      category: "glasses",
      productTitle: "Glasses B",
      productImage: "https://shop.com/B.jpg",
    });
    state = reducer(state, {
      type: "START",
      jobId: "job_B",
      category: "glasses",
      productTitle: "Glasses B",
      productImage: "https://shop.com/B.jpg",
      message: "Je prépare…",
    });
    state = reducer(state, {
      type: "READY",
      resultUrl: "https://cdn.example.com/B.png",
      opinion: "B!",
    });

    expect(state.history).toHaveLength(2);
    expect(state.history[0].productTitle).toBe("Watch A");
    expect(state.history[1].productTitle).toBe("Glasses B");
  });

  it("CART_STATUS_FOR_ENTRY updates only the matching card", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      history: [
        {
          id: "e1",
          jobId: "j1",
          category: "watch",
          status: "ready",
          progress: 100,
          resultUrl: "r1",
          opinion: "o1",
          cartStatus: "idle",
          createdAt: 1,
        },
        {
          id: "e2",
          jobId: "j2",
          category: "glasses",
          status: "ready",
          progress: 100,
          resultUrl: "r2",
          opinion: "o2",
          cartStatus: "idle",
          createdAt: 2,
        },
      ],
    };

    const next = reducer(seeded, {
      type: "CART_STATUS_FOR_ENTRY",
      entryId: "e1",
      status: "added",
    });

    expect(next.history[0].cartStatus).toBe("added");
    expect(next.history[1].cartStatus).toBe("idle");
  });

  it("PROGRESS keeps the matching pending entry in sync", () => {
    let state = reducer(
      { ...INITIAL, active: true, category: "watch" },
      {
        type: "START",
        jobId: "j1",
        category: "watch",
        message: "go",
      }
    );
    state = reducer(state, {
      type: "PROGRESS",
      jobId: "j1",
      status: "generating",
      progress: 47,
    });
    expect(state.history[0].progress).toBe(47);
    expect(state.history[0].stageStatus).toBe("generating");
  });

  it("READY finalises the matching pending entry by jobId", () => {
    let state = reducer(
      { ...INITIAL, active: true, category: "watch" },
      { type: "START", jobId: "j1", category: "watch", message: "go" }
    );
    // Start a second concurrent attempt — both pending.
    state = reducer(state, {
      type: "START",
      jobId: "j2",
      category: "glasses",
      message: "go2",
    });

    expect(state.history).toHaveLength(2);

    // Fetch for j1 resolves AFTER the simulator switched to j2.
    state = reducer(state, {
      type: "READY",
      jobId: "j1",
      resultUrl: "r1",
      opinion: "o1",
    });

    expect(state.history[0].status).toBe("ready");
    expect(state.history[0].resultUrl).toBe("r1");
    // j2 is untouched, still pending.
    expect(state.history[1].status).toBe("pending");
  });

  it("HYDRATE keeps pending entries pending (no auto-interrupt)", () => {
    const stale: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      history: [
        {
          id: "e1",
          jobId: "j1",
          category: "watch",
          status: "pending",
          progress: 32,
          stageStatus: "generating",
          cartStatus: "idle",
          createdAt: 1,
        },
      ],
    };

    const next = reducer(INITIAL, { type: "HYDRATE", state: stale });
    expect(next.history).toHaveLength(1);
    expect(next.history[0].status).toBe("pending");
    expect(next.history[0].progress).toBe(32);
    expect(next.jobId).toBe("j1");
  });

  it("BOOT on a new PDP preserves a running pending job", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      status: "generating",
      progress: 55,
      jobId: "j1",
      productImage: "https://shop.com/A.jpg",
      history: [
        {
          id: "e1",
          jobId: "j1",
          category: "watch",
          status: "pending",
          progress: 55,
          stageStatus: "generating",
          productImage: "https://shop.com/A.jpg",
          cartStatus: "idle",
          createdAt: 1,
        },
      ],
    };

    const next = reducer(seeded, {
      type: "BOOT",
      category: "watch",
      productImage: "https://shop.com/B.jpg",
      productUrl: "https://shop.com/B",
    });

    expect(next.history[0].status).toBe("pending");
    expect(next.jobId).toBe("j1");
    expect(next.progress).toBe(55);
    expect(next.productImage).toBe("https://shop.com/B.jpg");
  });

  it("clearSession wipes the history along with the rest of the state", () => {
    const seeded: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      history: [
        {
          id: "e1",
          jobId: "j1",
          category: "watch",
          status: "ready",
          progress: 100,
          resultUrl: "r1",
          opinion: "o1",
          cartStatus: "idle",
          createdAt: 1,
        },
      ],
    };

    const next = reducer(seeded, { type: "RESET" });
    expect(next.history).toHaveLength(0);
  });
});

describe("assistant session persistence helpers", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("saveToSession + loadFromSession round-trip", () => {
    const state: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      messages: [makeMessage("persisted")],
      productTitle: "Test",
    };
    saveToSession(state);

    const restored = loadFromSession();
    expect(restored).not.toBeNull();
    expect(restored!.messages).toHaveLength(1);
    expect(restored!.messages[0].text).toBe("persisted");
    expect(restored!.productTitle).toBe("Test");
  });

  it("saveToSession persists minimized as false (always reopen unminimized)", () => {
    const state: TryOnAssistantState = {
      ...INITIAL,
      active: true,
      minimized: true,
      messages: [makeMessage("x")],
    };
    saveToSession(state);
    const restored = loadFromSession();
    expect(restored?.minimized).toBe(false);
  });

  it("clearSessionStorage wipes the persisted payload", () => {
    saveToSession({
      ...INITIAL,
      active: true,
      messages: [makeMessage("x")],
    });
    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    clearSessionStorage();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("loadFromSession ignores malformed payloads", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "not-json");
    expect(loadFromSession()).toBeNull();
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ bad: 1 }));
    expect(loadFromSession()).toBeNull();
  });
});
