import { NextRequest, NextResponse } from "next/server";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/utils";
import { removeProductBackground } from "@/lib/providers/falBackgroundRemove";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BG_REMOVE_BYTES = 8 * 1024 * 1024;

function hasFalKey(): boolean {
  return Boolean(
    process.env.FAL_KEY?.trim() || process.env.AI_TRYON_API_KEY?.trim()
  );
}

function safeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unknown error";
  const falKey = process.env.FAL_KEY?.trim();
  let cleaned = raw;
  if (falKey) cleaned = cleaned.split(falKey).join("[REDACTED]");
  cleaned = cleaned.replace(
    /(api[_-]?key|authorization|bearer)[=:\s]+\S+/gi,
    "$1=[REDACTED]"
  );
  return cleaned;
}

/**
 * Detach a product photo from its background and return a transparent PNG.
 *
 *   POST /api/product/cutout
 *
 * Input  : multipart/form-data with EITHER:
 *            - productImage : File       (max 8 MB)
 *            - imageUrl     : string
 * Output : { ok: true,  cutoutUrl, provider: "fal", model }
 *          { ok: false, error }
 */
export async function POST(request: NextRequest) {
  if (!hasFalKey()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Le détourage automatique nécessite une clé fal.ai configurée côté serveur.",
      },
      { status: 503 }
    );
  }

  try {
    const formData = await request.formData();
    const fileEntry = formData.get("productImage");
    const urlEntry = formData.get("imageUrl");

    let file: File | undefined;
    let imageUrl: string | undefined;

    if (fileEntry instanceof File && fileEntry.size > 0) {
      if (!ACCEPTED_IMAGE_TYPES.includes(fileEntry.type)) {
        return NextResponse.json(
          {
            ok: false,
            error: "Format non accepté (JPG, PNG, WebP uniquement).",
          },
          { status: 400 }
        );
      }
      if (fileEntry.size > MAX_BG_REMOVE_BYTES) {
        return NextResponse.json(
          { ok: false, error: "Fichier trop volumineux (max 8 Mo)." },
          { status: 400 }
        );
      }
      file = fileEntry;
    } else if (typeof urlEntry === "string" && urlEntry.trim()) {
      const trimmed = urlEntry.trim();
      try {
        const u = new URL(trimmed);
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          throw new Error("Invalid scheme");
        }
        imageUrl = trimmed;
      } catch {
        return NextResponse.json(
          { ok: false, error: "URL d'image invalide." },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Aucune image fournie. Envoyez productImage (fichier) ou imageUrl.",
        },
        { status: 400 }
      );
    }

    const started = Date.now();
    const result = await removeProductBackground({ file, imageUrl });
    const durationMs = Date.now() - started;

    console.info(
      `[cutout] success model=${result.model} durationMs=${durationMs}`
    );

    return NextResponse.json({
      ok: true,
      cutoutUrl: result.cutoutUrl,
      provider: result.provider,
      model: result.model,
      durationMs,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error("[cutout] error", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
