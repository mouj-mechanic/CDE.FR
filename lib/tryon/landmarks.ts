"use client";

/**
 * Browser-side landmark detection using MediaPipe Tasks Vision.
 *
 *  - FaceLandmarker : glasses, headwear  (478 points)
 *  - HandLandmarker : watch, hand-jewelry (21 points)
 *  - PoseLandmarker : clothes            (33 points, stubbed for now)
 *
 * The MediaPipe runtime + model files are loaded lazily from Google's CDN
 * the first time `detectLandmarks()` is called, so the home page bundle is
 * not affected. We cache the instantiated landmarkers across calls.
 *
 * If MediaPipe fails to load (offline, blocked CDN), the function returns
 * `null` and the caller surfaces a `landmarks-missing` warning to the user.
 */

import type { CategoryId } from "@/types";
import type { LandmarkPoint, TryOnLandmarks } from "./types";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

const MODEL_URLS = {
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
} as const;

type MpFaceLandmarker = {
  detect: (img: HTMLImageElement | HTMLCanvasElement | ImageBitmap) => {
    faceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
  };
  close?: () => void;
};
type MpHandLandmarker = {
  detect: (img: HTMLImageElement | HTMLCanvasElement | ImageBitmap) => {
    landmarks?: Array<
      Array<{ x: number; y: number; z?: number; visibility?: number }>
    >;
    handednesses?: Array<Array<{ categoryName?: string }>>;
  };
  close?: () => void;
};

let faceLandmarkerPromise: Promise<MpFaceLandmarker> | null = null;
let handLandmarkerPromise: Promise<MpHandLandmarker> | null = null;

async function getFaceLandmarker(): Promise<MpFaceLandmarker> {
  if (faceLandmarkerPromise) return faceLandmarkerPromise;
  faceLandmarkerPromise = (async () => {
    const { FilesetResolver, FaceLandmarker } = await import(
      "@mediapipe/tasks-vision"
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    return (await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URLS.face },
      runningMode: "IMAGE",
      numFaces: 1,
    })) as unknown as MpFaceLandmarker;
  })();
  return faceLandmarkerPromise;
}

async function getHandLandmarker(): Promise<MpHandLandmarker> {
  if (handLandmarkerPromise) return handLandmarkerPromise;
  handLandmarkerPromise = (async () => {
    const { FilesetResolver, HandLandmarker } = await import(
      "@mediapipe/tasks-vision"
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    return (await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URLS.hand },
      runningMode: "IMAGE",
      numHands: 1,
    })) as unknown as MpHandLandmarker;
  })();
  return handLandmarkerPromise;
}

/** Load an image File into an HTMLImageElement. */
export async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.crossOrigin = "anonymous";
      img.src = url;
    });
  } finally {
    // Caller may still need the data URL; we revoke later.
  }
}

function pointsFromMpArray(
  arr: Array<{ x: number; y: number; z?: number; visibility?: number }>
): LandmarkPoint[] {
  return arr.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    visibility: p.visibility,
  }));
}

/**
 * Permanently filter benign MediaPipe / TFLite WASM logs.
 *
 *  Why permanent (vs a try/finally wrapper around `detect()`)?
 *  ──────────────────────────────────────────────────────────
 *  The Emscripten/WASM runtime in `@mediapipe/tasks-vision` can post log
 *  lines back to the main thread asynchronously (through `postMessage`),
 *  so by the time the *real* `console.error` fires the synchronous wrapper
 *  has already been restored. Next.js dev overlay then surfaces them as
 *  errors even though detection succeeded.
 *
 *  The filter is installed exactly once on the first import, in the
 *  browser only, and is identity-no-op for any non-MediaPipe message.
 */
const MP_LOG_NOISE =
  /TensorFlow ?Lite|XNNPACK|Created TensorFlow|MediaPipe|gl_context|OpenGL|tflite|WASM|Graph successfully/i;

function isMpNoise(args: unknown[]): boolean {
  const text = args
    .map((a) => (a instanceof Error ? a.message : String(a)))
    .join(" ");
  return MP_LOG_NOISE.test(text);
}

declare global {
  // Marker so HMR doesn't double-wrap console methods.
  var __twa_mp_console_filter_installed__: boolean | undefined;
}

if (
  typeof window !== "undefined" &&
  !globalThis.__twa_mp_console_filter_installed__
) {
  globalThis.__twa_mp_console_filter_installed__ = true;
  const wrap =
    (original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      if (isMpNoise(args)) return;
      original.apply(console, args);
    };
  console.error = wrap(console.error);
  console.warn = wrap(console.warn);
  console.log = wrap(console.log);
  console.info = wrap(console.info);
}

/**
 * Detect the landmarks relevant to the requested category.
 * Returns `null` if MediaPipe is unavailable or the target was not found.
 */
export async function detectLandmarks(
  img: HTMLImageElement,
  category: CategoryId
): Promise<TryOnLandmarks | null> {
  if (typeof window === "undefined") return null;

  const imageWidth = img.naturalWidth || img.width;
  const imageHeight = img.naturalHeight || img.height;

  try {
    if (category === "glasses" || category === "headwear") {
      const lm = await getFaceLandmarker();
      const res = lm.detect(img);
      const first = res?.faceLandmarks?.[0];
      if (!first || first.length < 100) return null;
      return {
        category,
        imageWidth,
        imageHeight,
        face: pointsFromMpArray(first),
      };
    }
    if (category === "watch" || category === "hand-jewelry") {
      const lm = await getHandLandmarker();
      const res = lm.detect(img);
      const first = res?.landmarks?.[0];
      if (!first || first.length < 21) return null;
      const handedRaw =
        res?.handednesses?.[0]?.[0]?.categoryName?.toLowerCase();
      const handedness =
        handedRaw === "left"
          ? ("Left" as const)
          : handedRaw === "right"
            ? ("Right" as const)
            : ("unknown" as const);
      return {
        category,
        imageWidth,
        imageHeight,
        hand: pointsFromMpArray(first),
        handedness,
      };
    }
    // clothes / pose: not implemented client-side yet — fallback to AI provider.
    return null;
  } catch (err) {
    console.warn("[tryon/landmarks] detection failed", err);
    return null;
  }
}

/** Free MediaPipe resources (call on page unmount if you like). */
export function disposeLandmarkers(): void {
  faceLandmarkerPromise?.then((l) => l.close?.()).catch(() => {});
  handLandmarkerPromise?.then((l) => l.close?.()).catch(() => {});
  faceLandmarkerPromise = null;
  handLandmarkerPromise = null;
}
