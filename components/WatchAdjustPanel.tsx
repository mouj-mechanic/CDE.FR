"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RotateCcw,
  Check,
  Sparkles,
  Move,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { fileToImage } from "@/lib/tryon/landmarks";
import { loadImageFromBlob } from "@/lib/tryon/productPrep";
import { detectLandmarks } from "@/lib/tryon/landmarks";
import {
  DEFAULT_WATCH_ADJUSTMENTS,
  renderWatchOverlay,
  type WatchAdjustments,
} from "@/lib/tryon/renderWatchOverlay";
import type { TryOnLandmarks } from "@/lib/tryon/types";

interface WatchAdjustPanelProps {
  userFile: File;
  productFile: File | null;
  productCutoutUrl: string | null;
  initialAdjustments?: Partial<WatchAdjustments>;
  /** Called when the user-validated preview should replace the result. */
  onValidate: (blob: Blob, adjustments: WatchAdjustments) => void;
  /** Called when the user wants AI refinement on top of the preview. */
  onRefineWithAI?: (blob: Blob, adjustments: WatchAdjustments) => void;
  /** Live-preview source URL (used to keep the result view in sync). */
  onPreviewUrl?: (url: string) => void;
}

/**
 * Manual adjustment panel for the watch try-on.
 *
 *  - Loads the user photo + product image once.
 *  - Detects hand landmarks once.
 *  - Re-runs `renderWatchOverlay` on slider changes (debounced via rAF).
 *  - Streams the resulting blob URL up via `onPreviewUrl`.
 */
export function WatchAdjustPanel({
  userFile,
  productFile,
  productCutoutUrl,
  initialAdjustments,
  onValidate,
  onRefineWithAI,
  onPreviewUrl,
}: WatchAdjustPanelProps) {
  const [adj, setAdj] = useState<WatchAdjustments>({
    ...DEFAULT_WATCH_ADJUSTMENTS,
    ...(initialAdjustments ?? {}),
  });
  const [collapsed, setCollapsed] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detection, setDetection] = useState<
    | { state: "detected"; confidence: number }
    | { state: "low-confidence"; confidence: number }
    | { state: "missing" }
    | null
  >(null);

  const userImgRef = useRef<HTMLImageElement | null>(null);
  const productImgRef = useRef<HTMLImageElement | null>(null);
  const landmarksRef = useRef<TryOnLandmarks | null>(null);
  const lastUrlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const requestedRef = useRef<WatchAdjustments | null>(null);

  // Load assets + landmarks once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const userImg = await fileToImage(userFile);
        if (cancelled) return;
        userImgRef.current = userImg;

        let productImg: HTMLImageElement | null = null;
        if (productCutoutUrl) {
          try {
            const resp = await fetch(productCutoutUrl);
            if (resp.ok) {
              const blob = await resp.blob();
              productImg = await loadImageFromBlob(blob);
            }
          } catch {
            // ignore — fallback below
          }
        }
        if (!productImg && productFile) {
          productImg = await fileToImage(productFile);
        }
        if (!productImg) {
          if (!cancelled) setError("Image produit indisponible.");
          return;
        }
        productImgRef.current = productImg;

        const lm = await detectLandmarks(userImg, "watch");
        if (cancelled) return;
        landmarksRef.current = lm;
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Erreur de chargement.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userFile, productFile, productCutoutUrl]);

  // Render preview whenever adjustments change (rAF-debounced).
  const scheduleRender = useCallback(
    (next: WatchAdjustments) => {
      requestedRef.current = next;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(async () => {
        rafRef.current = null;
        const target = requestedRef.current;
        if (!target) return;
        const userImg = userImgRef.current;
        const productImg = productImgRef.current;
        if (!userImg || !productImg) return;
        setRendering(true);
        try {
          const res = await renderWatchOverlay({
            userImage: userImg,
            productImage: productImg,
            landmarks: landmarksRef.current,
            adjustments: target,
          });
          setLastBlob(res.blob);
          if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
          lastUrlRef.current = res.url;
          onPreviewUrl?.(res.url);
          if (!res.fromLandmarks) {
            setDetection({ state: "missing" });
          } else if (res.confidence < 0.45) {
            setDetection({
              state: "low-confidence",
              confidence: res.confidence,
            });
          } else {
            setDetection({ state: "detected", confidence: res.confidence });
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Erreur de rendu manuel."
          );
        } finally {
          setRendering(false);
        }
      });
    },
    [onPreviewUrl]
  );

  // Initial render once assets are ready.
  useEffect(() => {
    if (userImgRef.current && productImgRef.current) {
      scheduleRender(adj);
    }
  }, [scheduleRender, adj]);

  // Clean up object URL on unmount.
  useEffect(() => {
    return () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    setAdj(DEFAULT_WATCH_ADJUSTMENTS);
  }, []);

  const handleValidate = useCallback(() => {
    if (lastBlob) onValidate(lastBlob, adj);
  }, [lastBlob, onValidate, adj]);

  const handleAI = useCallback(async () => {
    if (!lastBlob || !onRefineWithAI) return;
    setAiBusy(true);
    try {
      await onRefineWithAI(lastBlob, adj);
    } finally {
      setAiBusy(false);
    }
  }, [lastBlob, onRefineWithAI, adj]);

  /**
   * Slider definitions.
   *
   * `display` describes how the value is rendered to the user (the
   * sliders themselves use the WatchAdjustments numeric range).
   *
   *  - offsetX/Y → -80..+80 px
   *  - scale     → 70..140 % (0.70..1.40 internally, default 1.00 = 100 %)
   *  - rotation  → -35..+35 ° (≈ ±0.61 rad)
   *  - curvature → 0..100   (0..1 internally, default 45)
   *  - shadow    → 0..100   (0..1 internally, default 60)
   */
  const sliders = useMemo(
    () => [
      {
        key: "offsetX" as const,
        label: "Position X",
        min: -80,
        max: 80,
        step: 1,
        unit: "px",
        toDisplay: (v: number) => v,
        fromDisplay: (v: number) => v,
      },
      {
        key: "offsetY" as const,
        label: "Position Y",
        min: -80,
        max: 80,
        step: 1,
        unit: "px",
        toDisplay: (v: number) => v,
        fromDisplay: (v: number) => v,
      },
      {
        key: "scale" as const,
        label: "Taille",
        min: 70,
        max: 140,
        step: 1,
        unit: "%",
        toDisplay: (v: number) => Math.round(v * 100),
        fromDisplay: (v: number) => v / 100,
      },
      {
        key: "rotation" as const,
        label: "Rotation",
        min: -35,
        max: 35,
        step: 1,
        unit: "°",
        toDisplay: (v: number) => Math.round((v * 180) / Math.PI),
        fromDisplay: (v: number) => (v * Math.PI) / 180,
      },
      {
        key: "curvature" as const,
        label: "Courbure du bracelet",
        min: 0,
        max: 100,
        step: 1,
        unit: "",
        toDisplay: (v: number) => Math.round(v * 100),
        fromDisplay: (v: number) => v / 100,
      },
      {
        key: "shadowIntensity" as const,
        label: "Intensité de l'ombre",
        min: 0,
        max: 100,
        step: 1,
        unit: "",
        toDisplay: (v: number) => Math.round(v * 100),
        fromDisplay: (v: number) => v / 100,
      },
    ],
    []
  );

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-bordeaux/15 bg-white/80 p-4 text-left shadow-soft backdrop-blur">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 text-sm font-semibold text-ink"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2">
          <Move className="h-4 w-4 text-bordeaux" aria-hidden />
          Ajustements de la montre
          {rendering && (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-bordeaux"
              aria-hidden
            />
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
          aria-hidden
        />
      </button>

      {detection && (
        <p
          className={`mt-1 text-[11px] ${
            detection.state === "detected"
              ? "text-emerald-700"
              : detection.state === "low-confidence"
                ? "text-amber-700"
                : "text-bordeaux"
          }`}
        >
          {detection.state === "detected" &&
            "Poignet détecté. Ajustez si nécessaire."}
          {detection.state === "low-confidence" &&
            "Ajustement manuel recommandé pour améliorer le placement."}
          {detection.state === "missing" &&
            "Poignet non détecté automatiquement. Ajustez la montre manuellement."}
        </p>
      )}

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-ink-muted">
                Si la montre paraît trop petite ou trop grande, ajustez la
                taille avant de valider.
              </p>

              {sliders.map((s) => {
                const displayValue = s.toDisplay(adj[s.key]);
                return (
                  <label key={s.key} className="block">
                    <span className="flex items-center justify-between text-xs text-ink-muted">
                      <span>{s.label}</span>
                      <span className="font-mono tabular-nums">
                        {displayValue}
                        {s.unit && ` ${s.unit}`}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={displayValue}
                      onChange={(e) => {
                        const next = {
                          ...adj,
                          [s.key]: s.fromDisplay(parseFloat(e.target.value)),
                        };
                        setAdj(next);
                        scheduleRender(next);
                      }}
                      className="mt-1 w-full accent-bordeaux"
                    />
                  </label>
                );
              })}

              {error && (
                <p className="text-xs text-bordeaux" role="alert">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={reset}
                  className="btn-ghost text-xs"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Réinitialiser
                </button>
                <button
                  type="button"
                  onClick={handleValidate}
                  className="btn-secondary text-xs"
                  disabled={!lastBlob}
                >
                  <Check className="h-4 w-4" aria-hidden />
                  Valider l&apos;aperçu
                </button>
                {onRefineWithAI && (
                  <button
                    type="button"
                    onClick={handleAI}
                    className="btn-primary text-xs"
                    disabled={!lastBlob || aiBusy}
                  >
                    {aiBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden />
                    )}
                    Améliorer avec l&apos;IA
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

