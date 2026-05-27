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

const INITIAL: TryOnAssistantState = {
  active: false,
  minimized: false,
  status: "idle",
  progress: 0,
  messages: [],
  cartStatus: "idle",
};

function reducer(
  state: TryOnAssistantState,
  action: Action
): TryOnAssistantState {
  switch (action.type) {
    case "START": {
      const intro = makeMessage("assistant", action.message, "progress");
      const shoppingTip = makeMessage(
        "assistant",
        "Vous pouvez réduire cette bulle et continuer vos achats — je vous préviens ici dès que c’est prêt.",
        "info"
      );
      return {
        ...INITIAL,
        active: true,
        minimized: false,
        status: "preparing",
        progress: 0,
        jobId: action.jobId,
        category: action.category,
        productTitle: action.productTitle,
        productUrl: action.productUrl,
        productImage: action.productImage,
        canAddToCart: true,
        cartStatus: "idle",
        messages: [intro, shoppingTip],
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

export function useTryOnAssistant() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const simulatorRef = useRef<SimulatedProgressHandle | null>(null);
  const jobIdRef = useRef<string | undefined>(undefined);

  const stopSimulator = useCallback(() => {
    if (simulatorRef.current) {
      simulatorRef.current.stop();
      simulatorRef.current = null;
    }
  }, []);

  // Stop the simulator on unmount so we don't leak rAF loops.
  useEffect(() => stopSimulator, [stopSimulator]);

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

  return {
    state,
    start,
    ready,
    error,
    minimize,
    restore,
    cartStatus,
    pushMessage,
    reset,
  };
}
