"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, RefreshCw, Check, X, SwitchCamera } from "lucide-react";
import {
  buildCameraConstraintsCascade,
  cameraErrorMessageFromName,
  detectCameraCapability,
  type CameraFacingMode,
} from "@/lib/camera/constraints";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File, previewUrl: string) => void;
  /**
   * Preferred initial facing mode. Wrist / hand photos benefit from
   * the rear camera ("environment"); selfies want the front one
   * ("user"). Falls back to whichever camera the device offers.
   */
  preferredFacingMode?: FacingMode;
  /**
   * Human-readable label shown above the modal. Defaults to "Prendre
   * une photo".
   */
  label?: string;
}

type FacingMode = CameraFacingMode;
type Status =
  | "idle"
  | "requesting"
  | "live"
  | "preview"
  | "error"
  | "insecure";

/**
 * Live camera capture modal, hardened for mobile Safari / iOS.
 *
 *  iOS Safari is notoriously fussy:
 *    - getUserMedia requires HTTPS (or localhost on desktop).
 *    - `facingMode: { exact: ... }` throws OverconstrainedError on
 *      many devices — we use `{ ideal: ... }` and cascade down to
 *      `video: true` if the device refuses.
 *    - the <video> element MUST have both `playsinline` and the
 *      legacy `webkit-playsinline` attribute set BEFORE the stream is
 *      attached, otherwise iOS goes full-screen and the modal layout
 *      breaks.
 *    - `video.play()` returns a Promise that rejects when the user
 *      gesture chain is broken; we re-attempt on the next animation
 *      frame because iOS sometimes drops the first call silently.
 *
 *  When getUserMedia is unusable (insecure context, denied permission,
 *  no camera) we fall back to a hidden `<input type="file" capture>`
 *  so the customer can still snap a picture via the native camera
 *  UI. That path works on every iPhone since iOS 6.
 */
export function CameraCapture({
  open,
  onClose,
  onCapture,
  preferredFacingMode = "user",
  label = "Prendre une photo",
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<FacingMode>(preferredFacingMode);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);

  const capability = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return "unsupported" as const;
    }
    return detectCameraCapability({
      isSecureContext: Boolean(window.isSecureContext),
      hasMediaDevices: Boolean(navigator.mediaDevices),
      hasGetUserMedia:
        typeof navigator.mediaDevices?.getUserMedia === "function",
    });
  }, []);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /**
   * Attach a stream to the <video> element and play it. iOS Safari
   * needs both `playsinline` attributes set BEFORE we call play(),
   * otherwise it'll either go full-screen or silently refuse.
   */
  const attachAndPlay = useCallback(async (stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) return false;

    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("autoplay", "true");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    // iOS Safari sometimes resolves play() with NotAllowedError when
    // the gesture chain is lost between the click → effect → promise.
    // We retry once on the next animation frame.
    const tryPlay = async (): Promise<boolean> => {
      try {
        await video.play();
        return true;
      } catch {
        return false;
      }
    };
    if (await tryPlay()) return true;
    return await new Promise<boolean>((resolve) => {
      requestAnimationFrame(async () => {
        const ok = await tryPlay();
        resolve(ok);
      });
    });
  }, []);

  /**
   * Try a list of constraints until one of them succeeds. We start
   * with the richest (ideal facing mode + sane resolution) and degrade
   * gracefully — `video: true` always works if any camera exists.
   */
  const startStream = useCallback(
    async (mode: FacingMode) => {
      setStatus("requesting");
      setErrorMessage(null);
      stopStream();

      if (capability === "insecure") {
        setStatus("insecure");
        setErrorMessage(
          "La caméra nécessite une connexion sécurisée (HTTPS). Vous pouvez importer une photo à la place."
        );
        return;
      }
      if (capability === "unsupported") {
        setStatus("error");
        setErrorMessage(
          "Votre navigateur ne propose pas l'accès direct à la caméra. Importez plutôt une photo."
        );
        return;
      }

      const cascade = buildCameraConstraintsCascade(mode);
      let lastErrName = "Error";
      for (const constraints of cascade) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(
            constraints
          );
          streamRef.current = stream;
          const ok = await attachAndPlay(stream);
          if (!ok) {
            setStatus("error");
            setErrorMessage(
              "Impossible de démarrer la vidéo de la caméra. Importez plutôt une photo."
            );
            return;
          }
          setStatus("live");
          return;
        } catch (err) {
          lastErrName = (err as { name?: string })?.name ?? "Error";
          // Loop again with looser constraints.
        }
      }

      setStatus("error");
      setErrorMessage(cameraErrorMessageFromName(lastErrName));
    },
    [capability, stopStream, attachAndPlay]
  );

  useEffect(() => {
    if (!open) {
      stopStream();
      setStatus("idle");
      setPreviewUrl((url) => {
        if (url) URL.revokeObjectURL(url);
        return null;
      });
      setCapturedFile(null);
      setErrorMessage(null);
      return;
    }
    startStream(facingMode);
    return () => stopStream();
    // We intentionally exclude `facingMode` so opening doesn't restart
    // — handleSwitchCamera triggers that explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSwitchCamera = useCallback(() => {
    const next: FacingMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    startStream(next);
  }, [facingMode, startStream]);

  const handleSnap = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Front-facing streams are mirrored on screen for the UX, but we
    // export the un-mirrored frame so the AI sees the customer's true
    // left/right.
    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `trywithai-camera-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const url = URL.createObjectURL(blob);
        setCapturedFile(file);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setStatus("preview");
        stopStream();
      },
      "image/jpeg",
      0.92
    );
  }, [stopStream]);

  const handleRetake = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCapturedFile(null);
    startStream(facingMode);
  }, [facingMode, startStream]);

  const handleValidate = useCallback(() => {
    if (capturedFile && previewUrl) {
      onCapture(capturedFile, previewUrl);
      setPreviewUrl(null);
      setCapturedFile(null);
      onClose();
    }
  }, [capturedFile, previewUrl, onCapture, onClose]);

  const handleFallbackChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      onCapture(file, url);
      onClose();
    },
    [onCapture, onClose]
  );

  if (!open) return null;

  const mirror = facingMode === "user";
  const fallbackCapture: "user" | "environment" = facingMode;

  return (
    <AnimatePresence>
      <motion.div
        key="cam-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 p-3 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          key="cam-panel"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-lifted"
        >
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
            <div className="flex items-center gap-2 text-ink">
              <Camera className="h-5 w-5 text-bordeaux" aria-hidden />
              <h3 className="font-display text-base font-semibold">{label}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost h-9 w-9 justify-center !px-0"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative aspect-[3/4] w-full bg-ink/95">
            {/*
              Always mount the <video> when the live/requesting flows
              are active, even before the stream resolves — that way
              videoRef is non-null when getUserMedia returns and we
              don't lose the user gesture on iOS.
            */}
            {(status === "live" || status === "requesting") && (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                disablePictureInPicture
                className={`h-full w-full object-cover ${
                  mirror ? "scale-x-[-1] transform" : ""
                }`}
              />
            )}

            {status === "preview" && previewUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewUrl}
                alt="Aperçu de la photo"
                className="h-full w-full object-cover"
              />
            )}

            {status === "requesting" && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                Activation de la caméra…
              </div>
            )}

            {(status === "error" || status === "insecure") && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-white/90">
                  {errorMessage ?? "Caméra indisponible."}
                </p>
                <button
                  type="button"
                  onClick={() => fallbackInputRef.current?.click()}
                  className="btn-primary"
                >
                  <Camera className="h-5 w-5" aria-hidden />
                  Prendre / importer une photo
                </button>
              </div>
            )}

            {/*
              The hidden file input is ALWAYS mounted so iOS Safari can
              fall through to it from the error/insecure states (and so
              we can trigger it programmatically from the "Prendre /
              importer une photo" button).
            */}
            <input
              ref={fallbackInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture={fallbackCapture}
              className="hidden"
              onChange={handleFallbackChange}
            />

            {status === "live" && (
              <button
                type="button"
                onClick={handleSwitchCamera}
                className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-ink shadow-soft transition hover:bg-white"
                aria-label="Changer de caméra"
              >
                <SwitchCamera className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-ink/10 bg-cream px-4 py-4">
            {status === "live" && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleSnap}
                  className="btn-primary"
                  aria-label="Capturer la photo"
                >
                  <Camera className="h-5 w-5" aria-hidden />
                  Capturer
                </button>
              </>
            )}

            {status === "preview" && (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="btn-secondary"
                >
                  <RefreshCw className="h-5 w-5" aria-hidden />
                  Reprendre
                </button>
                <button
                  type="button"
                  onClick={handleValidate}
                  className="btn-primary"
                >
                  <Check className="h-5 w-5" aria-hidden />
                  Utiliser cette photo
                </button>
              </>
            )}

            {(status === "requesting" ||
              status === "error" ||
              status === "insecure") && (
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary ml-auto"
              >
                Fermer
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
