"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  CategoryId,
  TryOnAssistantMessage,
  TryOnAssistantState,
  TryOnAssistantStatus,
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
      resultUrl: string;
      opinion: string;
      shareUrl?: string;
      fallbackUsed?: boolean;
    }
  | {
      type: "ERROR";
      message: string;
    }
  | {
      type: "CART_STATUS";
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
};

// Exported so the reducer is unit-testable in isolation.
export type AssistantAction = Action;

export function reducer(
  state: TryOnAssistantState,
  action: Action
): TryOnAssistantState {
  switch (action.type) {
    case "HYDRATE": {
      // Restore from sessionStorage. If the persisted state was
      // mid-job (preparing / applying / finalizing), reset that part
      // — server jobs can't be reattached across iframe reloads, so
      // the safest UX is to bring the customer back to the compose
      // view while keeping the entire chat history visible.
      const stored = action.state;
      const wasMidJob =
        stored.status === "preparing" ||
        stored.status === "analyzing_photo" ||
        stored.status === "preparing_product" ||
        stored.status === "placing_product" ||
        stored.status === "generating" ||
        stored.status === "quality_check";
      return {
        ...INITIAL,
        ...stored,
        active: true,
        minimized: false,
        status: wasMidJob ? "idle" : stored.status,
        progress: wasMidJob ? 0 : stored.progress,
      };
    }
    case "BOOT": {
      // Soft init: bubble becomes visible with the compose view, but
      // we PRESERVE the entire conversation history so refreshes /
      // navigations don't wipe the chat thread. Only the explicit
      // close (X button) clears the conversation.
      //
      // When the customer navigates to a *different* product page,
      // we drop the previous result so the compose view appears
      // again for the new product. Messages stay visible above.
      const productChanged =
        (Boolean(action.productUrl) &&
          action.productUrl !== state.productUrl) ||
        (Boolean(action.productImage) &&
          action.productImage !== state.productImage);
      return {
        ...state,
        active: true,
        category: action.category,
        productTitle: action.productTitle ?? state.productTitle,
        productUrl: action.productUrl ?? state.productUrl,
        productImage: action.productImage ?? state.productImage,
        status: productChanged ? "idle" : state.status,
        progress: productChanged ? 0 : state.progress,
        resultUrl: productChanged ? undefined : state.resultUrl,
        shareUrl: productChanged ? undefined : state.shareUrl,
        fallbackUsed: productChanged ? undefined : state.fallbackUsed,
        jobId: productChanged ? undefined : state.jobId,
        canAddToCart: state.canAddToCart ?? true,
        cartStatus: productChanged ? "idle" : (state.cartStatus ?? "idle"),
      };
    }
    case "START": {
      const intro = makeMessage("assistant", action.message, "progress");
      const shoppingTip = makeMessage(
        "assistant",
        "Vous pouvez réduire cette bulle et continuer vos achats — je vous préviens ici dès que c’est prêt.",
        "info"
      );
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
        // Append START messages to the existing thread — never wipe.
        messages: [...state.messages, intro, shoppingTip],
      };
    }
    case "PROGRESS":
      return {
        ...state,
        status: action.status,
        progress: Math.max(state.progress, Math.min(100, action.progress)),
      };
    case "MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "MINIMIZE":
      return { ...state, minimized: true };
    case "RESTORE":
      return { ...state, minimized: false };
    case "READY": {
      const successMessage = makeMessage(
        "assistant",
        "Votre simulation est prête ✨",
        "success"
      );
      const opinionMessage = makeMessage(
        "assistant",
        action.opinion,
        "opinion"
      );
      return {
        ...state,
        status: action.fallbackUsed ? "fallback_ready" : "ready",
        progress: 100,
        resultUrl: action.resultUrl,
        shareUrl: action.shareUrl,
        fallbackUsed: action.fallbackUsed,
        messages: [...state.messages, successMessage, opinionMessage],
      };
    }
    case "ERROR": {
      const errorMessage = makeMessage(
        "assistant",
        "Je n’ai pas pu finaliser ce rendu. Vous pouvez réessayer avec une photo plus nette ou essayer un autre modèle.",
        "error"
      );
      return {
        ...state,
        status: "error",
        messages: [...state.messages, errorMessage],
      };
    }
    case "CART_STATUS": {
      // Append a short confirmation/error message when relevant.
      let nextMessages = state.messages;
      if (action.status === "added") {
        nextMessages = [
          ...state.messages,
          makeMessage(
            "assistant",
            "Article ajouté au panier — vous pouvez continuer vos achats.",
            "success"
          ),
        ];
      } else if (action.status === "error") {
        nextMessages = [
          ...state.messages,
          makeMessage(
            "assistant",
            "Je n’ai pas pu ajouter l’article au panier. Essayez depuis la fiche produit.",
            "warning"
          ),
        ];
      }
      return { ...state, cartStatus: action.status, messages: nextMessages };
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
    return parsed;
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
  const simulatorRef = useRef<SimulatedProgressHandle | null>(null);
  const jobIdRef = useRef<string | undefined>(undefined);
  const hydratedRef = useRef(false);

  // Hydrate from sessionStorage on the very first mount. Runs before
  // any boot() / start() the consumer might fire in their own
  // useEffect (registration order).
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

  const stopSimulator = useCallback(() => {
    if (simulatorRef.current) {
      simulatorRef.current.stop();
      simulatorRef.current = null;
    }
  }, []);

  // Stop the simulator on unmount so we don't leak rAF loops.
  useEffect(() => stopSimulator, [stopSimulator]);

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
      stopSimulator();
      simulatorRef.current = startSimulatedProgress(args.category, (evt) => {
        dispatch({
          type: "PROGRESS",
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
      return jobId;
    },
    [stopSimulator]
  );

  const ready = useCallback(
    (args: ReadyArgs) => {
      stopSimulator();
      const jobId = jobIdRef.current ?? generateJobId();
      dispatch({
        type: "READY",
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
    [stopSimulator, state.category, state.productTitle]
  );

  const error = useCallback(
    (message: string) => {
      stopSimulator();
      const jobId = jobIdRef.current ?? generateJobId();
      dispatch({ type: "ERROR", message });
      postJobError({ jobId, message });
    },
    [stopSimulator]
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
    stopSimulator();
    jobIdRef.current = undefined;
    dispatch({ type: "RESET" });
  }, [stopSimulator]);

  /**
   * Soft reset for the "Try another model" action. Clears the
   * current result and any pending job, but keeps the conversation
   * history visible so the customer experiences a continuous chat.
   */
  const newTry = useCallback(() => {
    stopSimulator();
    jobIdRef.current = undefined;
    dispatch({ type: "NEW_TRY" });
  }, [stopSimulator]);

  /**
   * Hard reset: wipes the bubble state AND the persisted history
   * from sessionStorage. Called when the customer explicitly closes
   * the bubble (X button) — next visit starts a fresh conversation.
   */
  const clearSession = useCallback(() => {
    stopSimulator();
    jobIdRef.current = undefined;
    clearSessionStorage();
    dispatch({ type: "RESET" });
  }, [stopSimulator]);

  return {
    state,
    boot,
    start,
    ready,
    error,
    minimize,
    restore,
    cartStatus,
    pushMessage,
    reset,
    newTry,
    clearSession,
  };
}
