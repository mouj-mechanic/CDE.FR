"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  CategoryId,
  TryOnAssistantMessage,
  TryOnAssistantState,
  TryOnAssistantStatus,
  TryOnHistoryEntry,
} from "@/types";
import {
  generateJobId,
  postJobError,
  postJobProgress,
  postJobReady,
  postJobStarted,
  postMinimize,
  postRestore,
} from "@/lib/embedMessaging";
import {
  startSimulatedProgress,
  type SimulatedProgressHandle,
} from "@/lib/assistantProgress";

type Action =
  | {
      type: "BOOT";
      category: CategoryId;
      productTitle?: string;
      productUrl?: string;
      productImage?: string;
    }
  | {
      type: "START";
      jobId: string;
      category: CategoryId;
      productTitle?: string;
      productUrl?: string;
      productImage?: string;
      message: string;
    }
  | {
      type: "PROGRESS";
      jobId: string;
      status: TryOnAssistantStatus;
      progress: number;
      message?: string;
    }
  | {
      type: "MESSAGE";
      message: TryOnAssistantMessage;
    }
  | { type: "MINIMIZE" }
  | { type: "RESTORE" }
  | {
      type: "READY";
      /** When provided, finalises the matching pending entry only. */
      jobId?: string;
      resultUrl: string;
      opinion: string;
      shareUrl?: string;
      fallbackUsed?: boolean;
    }
  | {
      type: "ERROR";
      /** When provided, finalises the matching pending entry only. */
      jobId?: string;
      message: string;
    }
  | {
      type: "CART_STATUS";
      status: NonNullable<TryOnAssistantState["cartStatus"]>;
    }
  | {
      // Per-card cart status update — when the customer has multiple
      // history entries and adds one to the cart, only that entry's
      // status should change.
      type: "CART_STATUS_FOR_ENTRY";
      entryId: string;
      status: NonNullable<TryOnAssistantState["cartStatus"]>;
    }
  | {
      // Soft reset for "Try another model" — clears the result and
      // pending job, but PRESERVES the whole conversation history so
      // the customer sees a continuous chat thread until they
      // explicitly close the bubble.
      type: "NEW_TRY";
    }
  | {
      // Hydrate state from sessionStorage on iframe mount, so the
      // customer can navigate the merchant site (page reloads /
      // product browsing) and come back to the same conversation.
      type: "HYDRATE";
      state: TryOnAssistantState;
    }
  | { type: "RESET" };

/** Back-fill status/progress for payloads saved before v2 history. */
function normalizeHistory(
  entries: TryOnHistoryEntry[]
): TryOnHistoryEntry[] {
  return entries.map((e) => {
    if (e.status) {
      return {
        ...e,
        progress: typeof e.progress === "number" ? e.progress : 0,
      };
    }
    if (e.resultUrl) {
      return {
        ...e,
        status: "ready" as const,
        progress: 100,
      };
    }
    return {
      ...e,
      status: "pending" as const,
      progress: 0,
    };
  });
}

function makeMessage(
  role: TryOnAssistantMessage["role"],
  text: string,
  kind: TryOnAssistantMessage["kind"] = "info"
): TryOnAssistantMessage {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    kind,
    createdAt: Date.now(),
  };
}

export const INITIAL: TryOnAssistantState = {
  active: false,
  minimized: false,
  status: "idle",
  progress: 0,
  messages: [],
  cartStatus: "idle",
  history: [],
};

// Exported so the reducer is unit-testable in isolation.
export type AssistantAction = Action;

export function reducer(
  state: TryOnAssistantState,
  action: Action
): TryOnAssistantState {
  switch (action.type) {
    case "HYDRATE": {
      // Restore from sessionStorage. Any pending entry persisted
      // before a full iframe reload is now ORPHANED — the original
      // `/api/try-on` fetch is gone with the previous frame. We
      // flip those entries to "interrupted" (last-known progress
      // kept) so the card renders a clean "Reprendre" CTA instead
      // of a phantom progress bar stuck at 92%.
      const stored = action.state;
      const wasMidJob =
        stored.status === "preparing" ||
        stored.status === "analyzing_photo" ||
        stored.status === "preparing_product" ||
        stored.status === "placing_product" ||
        stored.status === "generating" ||
        stored.status === "quality_check";
      const history = normalizeHistory(stored.history ?? []).map((e) =>
        e.status === "pending"
          ? {
              ...e,
              status: "interrupted" as const,
              errorMessage:
                e.errorMessage ??
                "Simulation arrêtée — vous pouvez la relancer.",
            }
          : e
      );
      return {
        ...INITIAL,
        ...stored,
        active: true,
        minimized: false,
        history,
        // No more in-flight job — bubble lands back on idle.
        jobId: undefined,
        status: wasMidJob ? "idle" : stored.status,
        progress: wasMidJob ? 0 : (stored.progress ?? 0),
      };
    }
    case "BOOT": {
      // Soft init: bubble becomes visible. The HISTORY feed of every
      // article the customer already tried is ALWAYS preserved so
      // they can scroll up and see them, no matter which PDP they
      // navigate to. Only the X close button wipes the history.
      //
      // When the customer navigates to a different product page, we
      // bring back the compose view (status → idle) for the new
      // product. The previous history cards keep their cart/share
      // controls intact above.
      const productChanged =
        (Boolean(action.productUrl) &&
          action.productUrl !== state.productUrl) ||
        (Boolean(action.productImage) &&
          action.productImage !== state.productImage);
      const pending = (state.history ?? []).filter(
        (e) => e.status === "pending"
      );
      const activePending = pending[pending.length - 1];
      const hasRunningJob = Boolean(activePending);
      return {
        ...state,
        active: true,
        category: action.category,
        productTitle: action.productTitle ?? state.productTitle,
        productUrl: action.productUrl ?? state.productUrl,
        productImage: action.productImage ?? state.productImage,
        // When the customer browses to another PDP while a job is
        // still running, keep header progress + jobId for that job.
        status:
          productChanged && !hasRunningJob ? "idle" : state.status,
        progress:
          productChanged && !hasRunningJob ? 0 : state.progress,
        resultUrl: productChanged ? undefined : state.resultUrl,
        shareUrl: productChanged ? undefined : state.shareUrl,
        fallbackUsed: productChanged ? undefined : state.fallbackUsed,
        jobId: hasRunningJob ? activePending!.jobId : productChanged
          ? undefined
          : state.jobId,
        canAddToCart: state.canAddToCart ?? true,
        cartStatus: productChanged ? "idle" : (state.cartStatus ?? "idle"),
        // History is NEVER cleared by BOOT — only by RESET/clearSession.
        history: state.history ?? [],
      };
    }
    case "START": {
      // Push a new PENDING entry into the history feed. The
      // simulation panel renders INSIDE this entry's card, so when
      // the customer navigates to a different PDP the in-flight
      // attempt stays visible above the new compose form.
      const pendingEntry: TryOnHistoryEntry = {
        id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        jobId: action.jobId,
        category: action.category,
        productTitle: action.productTitle ?? state.productTitle,
        productUrl: action.productUrl ?? state.productUrl,
        productImage: action.productImage ?? state.productImage,
        status: "pending",
        progress: 0,
        stageStatus: "preparing",
        cartStatus: "idle",
        createdAt: Date.now(),
      };
      return {
        ...state,
        active: true,
        minimized: false,
        status: "preparing",
        progress: 0,
        jobId: action.jobId,
        category: action.category,
        productTitle: action.productTitle ?? state.productTitle,
        productUrl: action.productUrl ?? state.productUrl,
        productImage: action.productImage ?? state.productImage,
        canAddToCart: true,
        cartStatus: "idle",
        resultUrl: undefined,
        shareUrl: undefined,
        fallbackUsed: undefined,
        history: [...state.history, pendingEntry],
      };
    }
    case "PROGRESS": {
      const newProgress = Math.max(
        0,
        Math.min(100, action.progress)
      );
      // Update the matching pending card (supports concurrent jobs).
      const history = state.history.map((e) => {
        if (e.status === "pending" && e.jobId === action.jobId) {
          return {
            ...e,
            progress: Math.max(e.progress, newProgress),
            stageStatus: action.status,
          };
        }
        return e;
      });
      const touchesActiveJob =
        state.jobId === action.jobId ||
        history.some(
          (e) => e.status === "pending" && e.jobId === action.jobId
        );
      return {
        ...state,
        status: touchesActiveJob ? action.status : state.status,
        progress:
          state.jobId === action.jobId
            ? Math.max(state.progress, newProgress)
            : state.progress,
        history,
      };
    }
    case "MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "MINIMIZE":
      return { ...state, minimized: true };
    case "RESTORE":
      return { ...state, minimized: false };
    case "READY": {
      // Finalise the PENDING entry that this READY corresponds to
      // (matched by jobId). If none exists — e.g. legacy state — push
      // a brand-new entry instead so we never drop the result.
      const targetJobId = action.jobId ?? state.jobId;
      let didUpdate = false;
      const history = state.history.map((e) => {
        if (
          !didUpdate &&
          e.status === "pending" &&
          (targetJobId == null || e.jobId === targetJobId)
        ) {
          didUpdate = true;
          return {
            ...e,
            status: "ready" as const,
            progress: 100,
            resultUrl: action.resultUrl,
            shareUrl: action.shareUrl,
            opinion: action.opinion,
            fallbackUsed: action.fallbackUsed,
          };
        }
        return e;
      });
      if (!didUpdate) {
        history.push({
          id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          jobId: targetJobId ?? `job_${Date.now()}`,
          category: state.category ?? "watch",
          productTitle: state.productTitle,
          productUrl: state.productUrl,
          productImage: state.productImage,
          status: "ready",
          progress: 100,
          resultUrl: action.resultUrl,
          shareUrl: action.shareUrl,
          opinion: action.opinion,
          fallbackUsed: action.fallbackUsed,
          cartStatus: "idle",
          createdAt: Date.now(),
        });
      }
      return {
        ...state,
        status: action.fallbackUsed ? "fallback_ready" : "ready",
        progress: 100,
        resultUrl: action.resultUrl,
        shareUrl: action.shareUrl,
        fallbackUsed: action.fallbackUsed,
        history,
      };
    }
    case "ERROR": {
      // Finalise the matching pending entry as failed.
      const targetJobId = action.jobId ?? state.jobId;
      const friendly =
        "Je n’ai pas pu finaliser ce rendu. Vous pouvez réessayer avec une photo plus nette ou essayer un autre modèle.";
      let didUpdate = false;
      const history = state.history.map((e) => {
        if (
          !didUpdate &&
          e.status === "pending" &&
          (targetJobId == null || e.jobId === targetJobId)
        ) {
          didUpdate = true;
          return {
            ...e,
            status: "error" as const,
            errorMessage: action.message ?? friendly,
          };
        }
        return e;
      });
      return {
        ...state,
        status: "error",
        history,
      };
    }
    case "CART_STATUS": {
      // Backwards-compatible global cart status: apply to the LAST
      // history entry (the one whose buttons sit at the bottom of
      // the bubble) AND to the legacy cartStatus field used by the
      // minimised pill.
      let nextHistory = state.history;
      if (state.history.length > 0) {
        nextHistory = state.history.map((e, i) =>
          i === state.history.length - 1
            ? { ...e, cartStatus: action.status }
            : e
        );
      }
      return {
        ...state,
        cartStatus: action.status,
        history: nextHistory,
      };
    }
    case "CART_STATUS_FOR_ENTRY": {
      const nextHistory = state.history.map((e) =>
        e.id === action.entryId ? { ...e, cartStatus: action.status } : e
      );
      // Sync the legacy field too when it's the latest entry — keeps
      // the minimised pill consistent.
      const isLatest =
        state.history.length > 0 &&
        state.history[state.history.length - 1].id === action.entryId;
      return {
        ...state,
        history: nextHistory,
        cartStatus: isLatest ? action.status : state.cartStatus,
      };
    }
    case "NEW_TRY": {
      // Reset just enough to bring the compose view back; the entire
      // message history stays visible.
      const sep = makeMessage(
        "assistant",
        "Très bien — choisissez un autre modèle, je garde notre discussion.",
        "info"
      );
      return {
        ...state,
        status: "idle",
        progress: 0,
        resultUrl: undefined,
        shareUrl: undefined,
        fallbackUsed: undefined,
        cartStatus: "idle",
        jobId: undefined,
        messages: [...state.messages, sep],
      };
    }
    case "RESET":
      return INITIAL;
    default:
      return state;
  }
}

export interface StartArgs {
  category: CategoryId;
  productTitle?: string;
  productUrl?: string;
  productImage?: string;
}

export interface ReadyArgs {
  /**
   * Job identifier returned by `start()`. When set, only the
   * matching pending entry is finalised — important when several
   * try-ons run concurrently across PDPs.
   */
  jobId?: string;
  resultUrl: string;
  opinion: string;
  shareUrl?: string;
  fallbackUsed?: boolean;
  qualityStatus?: string;
}

/**
 * sessionStorage key holding the serialised assistant state. Bumping
 * the version suffix invalidates older payloads when the shape
 * changes (avoids hydrating into a broken state after a deploy).
 */
export const STORAGE_KEY = "trywithai-assistant-v1";

export function loadFromSession(): TryOnAssistantState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TryOnAssistantState;
    // Sanity check: must look like a state object.
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.messages)) {
      return null;
    }
    return {
      ...parsed,
      history: normalizeHistory(parsed.history ?? []),
    };
  } catch {
    return null;
  }
}

export function saveToSession(state: TryOnAssistantState) {
  if (typeof window === "undefined") return;
  try {
    // Don't persist transient flags that should reset on reload.
    const payload: TryOnAssistantState = {
      ...state,
      minimized: false,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded / private-browsing → swallow; persistence is
    // best-effort.
  }
}

export function clearSessionStorage() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export function useTryOnAssistant() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const simulatorsRef = useRef<Map<string, SimulatedProgressHandle>>(
    new Map()
  );
  const jobIdRef = useRef<string | undefined>(undefined);
  const hydratedRef = useRef(false);

  const stopSimulatorForJob = useCallback((jobId: string) => {
    const sim = simulatorsRef.current.get(jobId);
    if (sim) {
      sim.stop();
      simulatorsRef.current.delete(jobId);
    }
  }, []);

  const stopAllSimulators = useCallback(() => {
    simulatorsRef.current.forEach((sim) => sim.stop());
    simulatorsRef.current.clear();
  }, []);

  const startSimulatorForJob = useCallback(
    (jobId: string, category: CategoryId) => {
      stopSimulatorForJob(jobId);
      jobIdRef.current = jobId;
      const sim = startSimulatedProgress(category, (evt) => {
        dispatch({
          type: "PROGRESS",
          jobId,
          status: evt.status,
          progress: evt.progress,
        });
        postJobProgress({
          jobId,
          status: evt.status,
          progress: evt.progress,
          message: evt.message,
        });
      });
      simulatorsRef.current.set(jobId, sim);
    },
    [stopSimulatorForJob]
  );

  // Hydrate from sessionStorage on the very first mount.
  //
  // IMPORTANT: we never restart a fake simulator for `pending`
  // entries persisted across an iframe reload — the original
  // `fetch()` to `/api/try-on` died with the previous iframe so
  // there's no real response to wait for. Restarting the simulator
  // would just cap at 92% and freeze, hiding the older ready card
  // behind a phantom progress bar. Instead, HYDRATE marks any
  // dangling pending entry as `interrupted` so the customer sees a
  // friendly "Reprendre" CTA on that card.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = loadFromSession();
    if (stored) {
      dispatch({ type: "HYDRATE", state: stored });
    }
  }, []);

  // Persist state to sessionStorage whenever it changes (after
  // hydration). Skipped during SSR (no window).
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveToSession(state);
  }, [state]);

  // Stop all simulators on unmount so we don't leak rAF loops.
  useEffect(() => stopAllSimulators, [stopAllSimulators]);

  const boot = useCallback((args: StartArgs) => {
    dispatch({
      type: "BOOT",
      category: args.category,
      productTitle: args.productTitle,
      productUrl: args.productUrl,
      productImage: args.productImage,
    });
  }, []);

  const start = useCallback(
    (args: StartArgs) => {
      const jobId = generateJobId();
      jobIdRef.current = jobId;
      const introMessage = "Je prépare votre simulation IA…";
      dispatch({
        type: "START",
        jobId,
        category: args.category,
        productTitle: args.productTitle,
        productUrl: args.productUrl,
        productImage: args.productImage,
        message: introMessage,
      });
      postJobStarted({
        jobId,
        category: args.category,
        productTitle: args.productTitle,
        productUrl: args.productUrl,
        productImage: args.productImage,
        message: introMessage,
      });
      startSimulatorForJob(jobId, args.category);
      return jobId;
    },
    [startSimulatorForJob]
  );

  const ready = useCallback(
    (args: ReadyArgs) => {
      // Only stop the simulator when this READY corresponds to the
      // currently-tracked job. Otherwise an out-of-order resolve
      // would silently kill the simulation of a fresher attempt.
      const jobId = args.jobId ?? jobIdRef.current ?? generateJobId();
      stopSimulatorForJob(jobId);
      dispatch({
        type: "READY",
        jobId,
        resultUrl: args.resultUrl,
        opinion: args.opinion,
        shareUrl: args.shareUrl,
        fallbackUsed: args.fallbackUsed,
      });
      postJobReady({
        jobId,
        resultUrl: args.resultUrl,
        shareUrl: args.shareUrl ?? args.resultUrl,
        productTitle: state.productTitle,
        category: state.category ?? "watch",
        opinion: args.opinion,
        qualityStatus: args.qualityStatus,
        fallbackUsed: args.fallbackUsed,
      });
    },
    [stopSimulatorForJob, state.category, state.productTitle]
  );

  const error = useCallback(
    (message: string, jobId?: string) => {
      const resolvedJobId = jobId ?? jobIdRef.current ?? generateJobId();
      stopSimulatorForJob(resolvedJobId);
      dispatch({ type: "ERROR", jobId: resolvedJobId, message });
      postJobError({ jobId: resolvedJobId, message });
    },
    [stopSimulatorForJob]
  );

  const minimize = useCallback(() => {
    dispatch({ type: "MINIMIZE" });
    postMinimize();
  }, []);

  const restore = useCallback(() => {
    dispatch({ type: "RESTORE" });
    postRestore();
  }, []);

  const cartStatus = useCallback(
    (status: NonNullable<TryOnAssistantState["cartStatus"]>) => {
      dispatch({ type: "CART_STATUS", status });
    },
    []
  );

  /**
   * Per-card cart status update. Use when the customer triggers an
   * add-to-cart on an older history card — only that card's status
   * changes.
   */
  const cartStatusForEntry = useCallback(
    (
      entryId: string,
      status: NonNullable<TryOnAssistantState["cartStatus"]>
    ) => {
      dispatch({ type: "CART_STATUS_FOR_ENTRY", entryId, status });
    },
    []
  );

  const pushMessage = useCallback(
    (
      text: string,
      kind: TryOnAssistantMessage["kind"] = "info",
      role: TryOnAssistantMessage["role"] = "assistant"
    ) => {
      dispatch({ type: "MESSAGE", message: makeMessage(role, text, kind) });
    },
    []
  );

  const reset = useCallback(() => {
    stopAllSimulators();
    jobIdRef.current = undefined;
    dispatch({ type: "RESET" });
  }, [stopAllSimulators]);

  /**
   * Soft reset for the "Try another model" action. Clears the
   * current result and any pending job, but keeps the conversation
   * history visible so the customer experiences a continuous chat.
   */
  const newTry = useCallback(() => {
    stopAllSimulators();
    jobIdRef.current = undefined;
    dispatch({ type: "NEW_TRY" });
  }, [stopAllSimulators]);

  /**
   * Hard reset: wipes the bubble state AND the persisted history
   * from sessionStorage. Called when the customer explicitly closes
   * the bubble (X button) — next visit starts a fresh conversation.
   */
  const clearSession = useCallback(() => {
    stopAllSimulators();
    jobIdRef.current = undefined;
    clearSessionStorage();
    dispatch({ type: "RESET" });
  }, [stopAllSimulators]);

  return {
    state,
    boot,
    start,
    ready,
    error,
    minimize,
    restore,
    cartStatus,
    cartStatusForEntry,
    pushMessage,
    reset,
    newTry,
    clearSession,
  };
}
