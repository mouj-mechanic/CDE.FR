"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { formatBytes, validateImageFile } from "@/lib/utils";

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
    <div className="space-y-4">
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
