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

  it("START appends to the conversation instead of replacing it", () => {
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

    expect(next.messages.length).toBeGreaterThan(1);
    expect(next.messages[0].text).toBe("earlier turn");
    expect(next.status).toBe("preparing");
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
