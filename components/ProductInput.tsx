"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { AnimatePresence, motion } from "framer-motion";
import {
  Link2,
  ImagePlus,
  Plus,
  Trash2,
  Store,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type {
  Category,
  ProductItem,
  ProductResolveResult,
  ProductSource,
} from "@/types";
import { generateId, isValidUrl, validateImageFile } from "@/lib/utils";

interface ProductInputProps {
  category: Category;
  products: ProductItem[];
  onAdd: (product: ProductItem) => void;
  onRemove: (id: string) => void;
  error?: string | null;
}

export function ProductInput({
  category,
  products,
  onAdd,
  onRemove,
  error,
}: ProductInputProps) {
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const isMulti = category.productInputMode === "multi";
  const canAddMore = isMulti || products.length === 0;

  const handleAddUrl = useCallback(async () => {
    const trimmed = urlInput.trim();
    setUrlError(null);
    setWarning(null);

    if (!trimmed) {
      setUrlError("Veuillez saisir une URL.");
      return;
    }
    if (!isValidUrl(trimmed)) {
      setUrlError("URL invalide. Utilisez http:// ou https://");
      return;
    }
    if (!canAddMore) {
      setUrlError("Un seul article suffit pour cette catégorie.");
      return;
    }

    setResolving(true);
    let resolved: ProductResolveResult | null = null;
    try {
      const res = await fetch("/api/product/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (res.ok) {
        resolved = (await res.json()) as ProductResolveResult;
      }
    } catch {
      // network errors are non-fatal; we still let the user add the raw URL
    } finally {
      setResolving(false);
    }

    if (resolved?.imageUrl) {
      onAdd({
        id: generateId(),
        type: "url",
        value: resolved.imageUrl,
        previewUrl: resolved.imageUrl,
        source: resolved.source as ProductSource,
        title: resolved.title,
      });
      setUrlInput("");
      return;
    }

    // No image detected — still let user add the page URL as a hint.
    onAdd({
      id: generateId(),
      type: "url",
      value: trimmed,
      source: "unknown",
      title: resolved?.title,
    });
    setUrlInput("");
    setWarning(
      "Image produit non détectée automatiquement. Importez une image produit pour un meilleur résultat."
    );
  }, [urlInput, canAddMore, onAdd]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;
      const validation = validateImageFile(file);
      if (!validation.valid) {
        setUrlError(validation.error ?? "Fichier invalide.");
        return;
      }
      if (!canAddMore && !isMulti) {
        setUrlError("Un seul article suffit pour cette catégorie.");
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      onAdd({
        id: generateId(),
        type: "image",
        value: file.name,
        file,
        previewUrl,
      });
      setUrlError(null);
      setWarning(null);
    },
    [canAddMore, isMulti, onAdd]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    disabled: !canAddMore || resolving,
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-xl font-semibold text-ink">
          Ajouter l&apos;article à essayer
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          {isMulti
            ? "Ajoutez un ou plusieurs liens produit ou images d'articles."
            : "Ajoutez un lien produit ou une image de l'article."}
        </p>
      </div>

      {/* URL input */}
      <div className="space-y-2">
        <label htmlFor="product-url" className="text-sm font-medium text-ink">
          Lien produit
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-light"
              aria-hidden
            />
            <input
              id="product-url"
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddUrl();
                }
              }}
              placeholder="https://boutique.com/produit..."
              className="input-field pl-10"
              disabled={!canAddMore || resolving}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              void handleAddUrl();
            }}
            disabled={!canAddMore || resolving}
            className="btn-secondary shrink-0 px-4"
            aria-label="Ajouter le lien"
          >
            {resolving ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-5 w-5" aria-hidden />
            )}
          </button>
        </div>
        {resolving && (
          <p className="text-xs text-ink-muted">Analyse du produit…</p>
        )}
        {warning && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {warning}
          </p>
        )}
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-ink/10" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-3 text-ink-muted">ou</span>
        </div>
      </div>

      {/* Image dropzone */}
      <div
        {...getRootProps()}
        className={`dropzone min-h-[140px] ${isDragActive ? "dropzone-active" : ""} ${!canAddMore ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <input {...getInputProps()} aria-label="Importer une image produit" />
        <ImagePlus className="mb-2 h-8 w-8 text-bordeaux/60" />
        <p className="text-sm font-medium text-ink">
          Importer une image de l&apos;article
        </p>
        <p className="mt-1 text-xs text-ink-muted">JPG, PNG, WebP — max 10 Mo</p>
      </div>

      {/* Product list */}
      {products.length > 0 && (
        <ul className="space-y-2" role="list" aria-label="Articles ajoutés">
          <AnimatePresence>
            {products.map((product) => {
              const fromBoutique =
                product.source === "shopify" ||
                product.source === "jsonld" ||
                product.source === "opengraph" ||
                product.source === "direct-image";
              const hasPreview = !!product.previewUrl;
              const label = product.title
                ? product.title
                : product.type === "url"
                  ? "Lien produit"
                  : "Image produit";
              const subtitle = fromBoutique
                ? `Détecté via ${formatSource(product.source)}`
                : product.value;
              return (
                <motion.li
                  key={product.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`flex items-center gap-3 rounded-xl border p-3 shadow-soft ${
                    fromBoutique
                      ? "border-gold/40 bg-gradient-to-r from-gold/5 to-transparent"
                      : "border-ink/10 bg-white"
                  }`}
                >
                  {hasPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.previewUrl}
                      alt=""
                      className="h-14 w-14 rounded-lg object-cover ring-1 ring-ink/5"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-cream-dark">
                      <Link2 className="h-5 w-5 text-bordeaux" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink">
                        {label}
                      </p>
                      {fromBoutique && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-bordeaux">
                          <Store className="h-3 w-3" aria-hidden />
                          Boutique
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      {subtitle}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(product.id)}
                    className="btn-ghost p-2 text-bordeaux"
                    aria-label={`Supprimer ${product.title ?? product.value}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {(error || urlError) && (
        <p className="text-sm text-bordeaux" role="alert">
          {error || urlError}
        </p>
      )}
    </div>
  );
}

function formatSource(source: ProductSource | undefined): string {
  switch (source) {
    case "shopify":
      return "Shopify";
    case "jsonld":
      return "JSON-LD";
    case "opengraph":
      return "OpenGraph";
    case "direct-image":
      return "image directe";
    default:
      return "URL";
  }
}
