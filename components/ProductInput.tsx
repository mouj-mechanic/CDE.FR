"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Scissors,
  Sparkles,
} from "lucide-react";
import type {
  Category,
  CategoryId,
  ProductItem,
  ProductResolveResult,
  ProductSource,
} from "@/types";
import { generateId, isValidUrl, validateImageFile } from "@/lib/utils";
import { getImageAlphaStats } from "@/lib/tryon/alpha";
import { compressImageFile } from "@/lib/clientImageCompression";
import { safeFetchJson } from "@/lib/safeFetchJson";

interface ProductInputProps {
  category: Category;
  products: ProductItem[];
  onAdd: (product: ProductItem) => void;
  onUpdate?: (id: string, patch: Partial<Omit<ProductItem, "id">>) => void;
  onRemove: (id: string) => void;
  error?: string | null;
}

const CUTOUT_CATEGORIES: CategoryId[] = [
  "watch",
  "glasses",
  "headwear",
  "hand-jewelry",
];

/** Tailwind utility used to render transparent product images on a
 *  checkerboard so merchants can visually verify alpha is preserved. */
const CHECKERBOARD_CLASS =
  "[background-image:linear-gradient(45deg,#e5e5e5_25%,transparent_25%),linear-gradient(-45deg,#e5e5e5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e5e5_75%),linear-gradient(-45deg,transparent_75%,#e5e5e5_75%)] [background-size:10px_10px] [background-position:0_0,0_5px,5px_-5px,-5px_0px] bg-white";

async function requestCutout(item: ProductItem): Promise<{
  ok: boolean;
  cutoutUrl?: string;
  error?: string;
}> {
  const formData = new FormData();
  if (item.file) {
    // Compress raw uploads so /api/product/cutout never receives a body
    // that exceeds the serverless 4.5 MB limit. We keep PNG when present
    // to preserve any partial alpha the merchant supplied.
    let upload = item.file;
    try {
      upload = await compressImageFile(item.file, {
        maxDim: 1400,
        quality: 0.92,
        mimeType: item.file.type === "image/png" ? "image/png" : "image/jpeg",
        skipIfSmallerThan: 1.2 * 1024 * 1024,
      });
    } catch {
      // Fall back to original file if compression fails.
    }
    formData.append("productImage", upload);
  } else if (item.type === "url") {
    formData.append("imageUrl", item.value);
  } else {
    return { ok: false, error: "Aucune source d'image disponible." };
  }
  const result = await safeFetchJson<{
    ok: boolean;
    cutoutUrl?: string;
    error?: string;
  }>("/api/product/cutout", {
    method: "POST",
    body: formData,
  });
  if (result.nonJson || !result.data) {
    return {
      ok: false,
      error: result.errorMessage ?? "Échec du détourage.",
    };
  }
  if (!result.ok || !result.data.ok || !result.data.cutoutUrl) {
    return {
      ok: false,
      error: result.data.error ?? "Échec du détourage.",
    };
  }
  return { ok: true, cutoutUrl: result.data.cutoutUrl };
}

export function ProductInput({
  category,
  products,
  onAdd,
  onUpdate,
  onRemove,
  error,
}: ProductInputProps) {
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const isMulti = category.productInputMode === "multi";
  const canAddMore = isMulti || products.length === 0;
  const cutoutEnabled = CUTOUT_CATEGORIES.includes(category.id);
  const triggeredCutoutsRef = useRef<Set<string>>(new Set());
  const [alphaByProduct, setAlphaByProduct] = useState<
    Record<string, { hasAlpha: boolean; ratio: number } | undefined>
  >({});

  const triggerCutout = useCallback(
    async (item: ProductItem, opts: { force?: boolean } = {}) => {
      if (!onUpdate) return;
      if (item.cutoutPending) return;
      if (item.cutoutUrl && !opts.force) return;
      onUpdate(item.id, {
        cutoutPending: true,
        cutoutError: undefined,
      });
      const res = await requestCutout(item);
      if (res.ok && res.cutoutUrl) {
        onUpdate(item.id, {
          cutoutUrl: res.cutoutUrl,
          cutoutPending: false,
          cutoutError: undefined,
        });
      } else {
        onUpdate(item.id, {
          cutoutPending: false,
          cutoutError: res.error,
        });
      }
    },
    [onUpdate]
  );

  // Detect alpha on every freshly added product (cheap canvas scan).
  useEffect(() => {
    for (const p of products) {
      if (alphaByProduct[p.id] !== undefined) continue;
      const source: File | string | undefined = p.file ?? p.previewUrl ?? p.value;
      if (!source) continue;
      let cancelled = false;
      void (async () => {
        try {
          const stats = await getImageAlphaStats(source);
          if (cancelled) return;
          setAlphaByProduct((prev) => ({
            ...prev,
            [p.id]: {
              hasAlpha: stats.hasAlpha,
              ratio: stats.transparentPixelRatio,
            },
          }));
        } catch {
          if (cancelled) return;
          setAlphaByProduct((prev) => ({
            ...prev,
            [p.id]: { hasAlpha: false, ratio: 0 },
          }));
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [products, alphaByProduct]);

  // Auto-trigger cutout for accessory categories, BUT skip when the upload
  // is already a transparent PNG (no need to re-process it).
  useEffect(() => {
    if (!cutoutEnabled || !onUpdate) return;
    for (const p of products) {
      const alphaInfo = alphaByProduct[p.id];
      if (alphaInfo === undefined) continue; // wait for alpha probe
      if (alphaInfo.hasAlpha) continue; // already transparent, skip cutout
      if (
        !p.cutoutUrl &&
        !p.cutoutPending &&
        !p.cutoutError &&
        !triggeredCutoutsRef.current.has(p.id) &&
        (p.file || p.type === "url")
      ) {
        triggeredCutoutsRef.current.add(p.id);
        void triggerCutout(p);
      }
    }
  }, [cutoutEnabled, onUpdate, products, alphaByProduct, triggerCutout]);

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
              const alphaInfo = alphaByProduct[product.id];
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
                  className={`space-y-2 rounded-xl border p-3 shadow-soft ${
                    fromBoutique
                      ? "border-gold/40 bg-gradient-to-r from-gold/5 to-transparent"
                      : "border-ink/10 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {hasPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.previewUrl}
                        alt=""
                        className={`h-14 w-14 rounded-lg ring-1 ring-ink/5 ${
                          alphaInfo?.hasAlpha
                            ? `object-contain ${CHECKERBOARD_CLASS}`
                            : "object-cover"
                        }`}
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-cream-dark">
                        <Link2 className="h-5 w-5 text-bordeaux" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink">
                          {label}
                        </p>
                        {fromBoutique && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-bordeaux">
                            <Store className="h-3 w-3" aria-hidden />
                            Boutique
                          </span>
                        )}
                        {alphaInfo?.hasAlpha && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            PNG transparent
                          </span>
                        )}
                        {product.cutoutUrl && !alphaInfo?.hasAlpha && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            Détouré
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
                  </div>

                  {alphaInfo && !alphaInfo.hasAlpha && cutoutEnabled && !product.cutoutUrl && !product.cutoutPending && (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
                      <AlertTriangle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      />
                      Fond détecté : utilisez une image PNG transparente pour un meilleur rendu.
                    </p>
                  )}

                  {cutoutEnabled && (
                    <div className="space-y-2 border-t border-ink/5 pt-2">
                      {product.cutoutPending && (
                        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden
                          />
                          Détourage du produit…
                        </p>
                      )}

                      {!product.cutoutPending && product.cutoutUrl && (
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col items-center gap-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={product.previewUrl ?? product.value}
                              alt="Original"
                              className="h-14 w-14 rounded-lg bg-cream-dark object-contain ring-1 ring-ink/10"
                            />
                            <span className="text-[10px] uppercase tracking-wider text-ink-muted">
                              Original
                            </span>
                          </div>
                          <Scissors
                            className="h-4 w-4 text-bordeaux"
                            aria-hidden
                          />
                          <div className="flex flex-col items-center gap-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={product.cutoutUrl}
                              alt="Détouré"
                              className={`h-14 w-14 rounded-lg object-contain ring-1 ring-emerald-300 ${CHECKERBOARD_CLASS}`}
                            />
                            <span className="text-[10px] uppercase tracking-wider text-emerald-700">
                              Détouré
                            </span>
                          </div>
                        </div>
                      )}

                      {!product.cutoutPending && !product.cutoutUrl && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void triggerCutout(product)}
                            className="btn-secondary text-xs"
                          >
                            <Scissors className="h-4 w-4" aria-hidden />
                            Détourer le produit
                          </button>
                          <span className="text-[11px] text-ink-muted">
                            Détourage automatique recommandé
                          </span>
                        </div>
                      )}

                      {product.cutoutError && (
                        <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
                          <AlertTriangle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            aria-hidden
                          />
                          Le produit n&apos;a pas pu être détouré. Le rendu
                          risque d&apos;afficher un rectangle ou un fond
                          visible.
                        </p>
                      )}
                    </div>
                  )}
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
