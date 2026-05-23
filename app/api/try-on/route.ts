import { NextRequest, NextResponse } from "next/server";
import { isValidCategoryId } from "@/lib/categories";
import { generateTryOnImage } from "@/lib/tryOnService";
import { ACCEPTED_IMAGE_TYPES, MAX_FILE_SIZE } from "@/lib/utils";
import type { CategoryId, TryOnRequest } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function validateImageFile(file: File, label: string): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return `${label} : format non accepté (JPG, PNG, WebP uniquement).`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `${label} : fichier trop volumineux (max 10 Mo).`;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const categoryRaw = formData.get("category");
    if (typeof categoryRaw !== "string" || !isValidCategoryId(categoryRaw)) {
      return NextResponse.json(
        { error: "Catégorie invalide ou manquante." },
        { status: 400 }
      );
    }
    const category = categoryRaw as CategoryId;

    const userImage = formData.get("userImage");
    if (!(userImage instanceof File) || userImage.size === 0) {
      return NextResponse.json(
        { error: "Veuillez importer une photo de vous." },
        { status: 400 }
      );
    }
    const userImageError = validateImageFile(userImage, "Photo utilisateur");
    if (userImageError) {
      return NextResponse.json({ error: userImageError }, { status: 400 });
    }

    const productImages: File[] = [];
    const productImagesEntries = formData.getAll("productImages");
    for (const entry of productImagesEntries) {
      if (entry instanceof File && entry.size > 0) {
        const err = validateImageFile(entry, "Image produit");
        if (err) {
          return NextResponse.json({ error: err }, { status: 400 });
        }
        productImages.push(entry);
      }
    }

    let productUrls: string[] = [];
    const urlsRaw = formData.get("productUrls");
    if (typeof urlsRaw === "string" && urlsRaw.trim()) {
      try {
        const parsed: unknown = JSON.parse(urlsRaw);
        if (Array.isArray(parsed)) {
          productUrls = parsed.filter(
            (u): u is string => typeof u === "string" && u.trim().length > 0
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Format des URLs produit invalide." },
          { status: 400 }
        );
      }
    }

    if (productImages.length === 0 && productUrls.length === 0) {
      return NextResponse.json(
        {
          error:
            "Veuillez ajouter au moins un article (lien produit ou image).",
        },
        { status: 400 }
      );
    }

    const notesRaw = formData.get("notes");
    const notes =
      typeof notesRaw === "string" && notesRaw.trim()
        ? notesRaw.trim()
        : undefined;

    const params: TryOnRequest = {
      category,
      userImage,
      productImages,
      productUrls,
      notes,
    };

    const result = await generateTryOnImage(params);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[try-on]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Une erreur est survenue lors de la génération.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
