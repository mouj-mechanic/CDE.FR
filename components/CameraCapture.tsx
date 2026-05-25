"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, RefreshCw, Check, X, SwitchCamera } from "lucide-react";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File, previewUrl: string) => void;
}

type FacingMode = "user" | "environment";
type Status = "idle" | "requesting" | "live" | "preview" | "error";

/**
 * Live camera capture modal.
 *
 * - Uses `navigator.mediaDevices.getUserMedia` for a real-time preview.
 * - Snapshots the active frame to a canvas → JPEG blob → File.
 * - Lets the user retake or validate the shot.
 * - Falls back to a hidden `<input type="file" capture>` if getUserMedia
 *   is unavailable (older browsers, insecure context, denied permission).
 * - Front-facing camera by default (matches the use case: a person trying
 *   on accessories on themselves), with a toggle to swap to rear camera.
 */
export function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);

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

  const startStream = useCallback(
    async (mode: FacingMode) => {
      setStatus("requesting");
      setErrorMessage(null);
      stopStream();

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setStatus("error");
        setErrorMessage(
          "La caméra n'est pas accessible depuis ce navigateur. Utilisez l'import de fichier."
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("live");
      } catch (err) {
        setStatus("error");
        const name = (err as { name?: string })?.name ?? "Error";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setErrorMessage(
            "Accès à la caméra refusé. Autorisez la caméra dans les réglages du navigateur."
          );
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setErrorMessage(
            "Aucune caméra détectée. Importez plutôt une photo depuis votre appareil."
          );
        } else {
          setErrorMessage(
            "Impossible d'ouvrir la caméra. Importez plutôt une photo."
          );
        }
      }
    },
    [stopStream]
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

    // Front camera streams are mirrored on screen but exporting the raw
    // frame keeps the actual orientation, which is what we want for the
    // AI model (the customer's real left/right).
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
      // Hand off ownership of the object URL to the parent; clear refs so
      // the cleanup effect below doesn't revoke it after close.
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
        aria-label="Prendre une photo"
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
              <h3 className="font-display text-base font-semibold">
                Prendre une photo
              </h3>
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
            {(status === "live" || status === "requesting") && (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
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

            {status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-white/90">
                  {errorMessage ?? "Caméra indisponible."}
                </p>
                <button
                  type="button"
                  onClick={() => fallbackInputRef.current?.click()}
                  className="btn-primary"
                >
                  Importer une photo
                </button>
                <input
                  ref={fallbackInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="user"
                  className="hidden"
                  onChange={handleFallbackChange}
                />
              </div>
            )}

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

            {(status === "requesting" || status === "error") && (
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
