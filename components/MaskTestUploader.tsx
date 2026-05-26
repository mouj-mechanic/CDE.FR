"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageMinus, X } from "lucide-react";
import clsx from "clsx";

interface MaskTestUploaderProps {
  /** Current mask file (controlled by parent so it survives re-renders). */
  value: File | null;
  /** Called when the user picks a new mask or removes the current one. */
  onChange: (file: File | null) => void;
  /** Optional label override. */
  label?: string;
  className?: string;
}

/**
 * Optional manual mask uploader, available across all categories.
 *
 *  - Accepts a single PNG (the spec mandates PNG).
 *  - White pixels mark editable zones, black pixels mark preserved zones.
 *  - The mask must match the dimensions of the user photo — the server
 *    validates this and returns a 400 with a clear message on mismatch.
 *
 * The mask is appended to the FormData under the `maskImage` key (the
 * same key used by the watch's auto-generated contact-band mask, so a
 * single backend handler covers both cases).
 */
export function MaskTestUploader({
  value,
  onChange,
  label = "Importer un masque de test (optionnel)",
  className,
}: MaskTestUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const handleFile = useCallback(
    (file: File | null) => {
      if (!file) {
        onChange(null);
        return;
      }
      if (file.type !== "image/png") {
        // Surface the constraint immediately instead of letting the
        // server reject — better UX.
        window.alert("Le masque doit être un fichier PNG.");
        return;
      }
      onChange(file);
    },
    [onChange]
  );

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <label className="text-[11px] uppercase tracking-wider text-ink-muted/70">
        {label}
      </label>
      <div
        className={clsx(
          "flex items-center gap-3 rounded-xl border border-dashed border-ink-muted/30",
          "bg-white/40 p-2 text-xs text-ink-muted"
        )}
      >
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Aperçu du masque"
              className="h-12 w-12 rounded-md border border-ink-muted/20 object-contain"
            />
            <span className="flex-1 truncate text-[11px]">
              {value?.name ?? "mask.png"}
            </span>
            <button
              type="button"
              onClick={() => handleFile(null)}
              className="rounded-md p-1 text-ink-muted transition hover:bg-ink-muted/10"
              aria-label="Retirer le masque"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink/80 transition hover:bg-ink-muted/5"
          >
            <ImageMinus className="h-4 w-4" aria-hidden />
            <span className="text-[12px]">
              Choisir un PNG (blanc = zone à éditer, noir = zone préservée)
            </span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
      </div>
    </div>
  );
}
