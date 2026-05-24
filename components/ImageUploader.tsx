"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ImagePlus, Sparkles, Trash2, Upload } from "lucide-react";
import { formatBytes, validateImageFile } from "@/lib/utils";
import { ConfettiBurst } from "./ConfettiBurst";

interface ImageUploaderProps {
  previewUrl: string | null;
  onImageSelect: (file: File, previewUrl: string) => void;
  onImageClear: () => void;
  error?: string | null;
}

export function ImageUploader({
  previewUrl,
  onImageSelect,
  onImageClear,
  error,
}: ImageUploaderProps) {
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const [showXp, setShowXp] = useState(false);
  const previousPreview = useRef<string | null>(previewUrl);

  useEffect(() => {
    // Trigger celebration only on transition from "no photo" → "photo".
    if (previewUrl && !previousPreview.current) {
      setConfettiTrigger((n) => n + 1);
      setShowXp(true);
      const t = setTimeout(() => setShowXp(false), 1800);
      previousPreview.current = previewUrl;
      return () => clearTimeout(t);
    }
    previousPreview.current = previewUrl;
  }, [previewUrl]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;
      const validation = validateImageFile(file);
      if (!validation.valid) return;
      const url = URL.createObjectURL(file);
      onImageSelect(file, url);
    },
    [onImageSelect]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      accept: {
        "image/jpeg": [".jpg", ".jpeg"],
        "image/png": [".png"],
        "image/webp": [".webp"],
      },
      maxFiles: 1,
      maxSize: 10 * 1024 * 1024,
    });

  const rejectionError = fileRejections[0]?.errors[0]?.message;

  return (
    <div className="relative space-y-4">
      <ConfettiBurst trigger={confettiTrigger} />
      <AnimatePresence mode="wait">
        {previewUrl ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-soft"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Aperçu de votre photo"
              className="mx-auto max-h-80 w-full object-contain"
            />

            {/* Success badge in top-left */}
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.15, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-emerald-600/95 px-3 py-1 text-xs font-semibold text-white shadow-soft"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Photo capturée
            </motion.div>

            <AnimatePresence>
              {showXp && (
                <motion.div
                  key="xp"
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: -8, scale: 1 }}
                  exit={{ opacity: 0, y: -28 }}
                  transition={{ duration: 0.7 }}
                  className="absolute left-1/2 top-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gold px-4 py-1.5 text-sm font-bold text-ink shadow-lifted"
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  +50 XP
                </motion.div>
              )}
            </AnimatePresence>

            <div className="absolute bottom-4 right-4 flex gap-2">
              <button
                type="button"
                onClick={onImageClear}
                className="btn-ghost bg-white/90 shadow-soft"
                aria-label="Supprimer la photo"
              >
                <Trash2 className="h-4 w-4" />
                Supprimer
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              {...getRootProps()}
              className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
            >
              <input {...getInputProps()} aria-label="Importer votre photo" />
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bordeaux/10 text-bordeaux">
                  {isDragActive ? (
                    <Upload className="h-7 w-7" />
                  ) : (
                    <ImagePlus className="h-7 w-7" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-ink">
                    {isDragActive
                      ? "Déposez votre photo ici"
                      : "Glissez votre photo ou cliquez pour importer"}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    JPG, PNG, WebP — max {formatBytes(10 * 1024 * 1024)}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(error || rejectionError) && (
        <p className="text-sm text-bordeaux" role="alert">
          {error || rejectionError}
        </p>
      )}
    </div>
  );
}
