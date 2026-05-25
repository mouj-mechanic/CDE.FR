import { NextRequest, NextResponse } from "next/server";
import { resolveProduct } from "@/lib/productResolver";

export const runtime = "nodejs";
export const maxDuration = 15;

interface ResolveBody {
  url?: unknown;
}

export async function POST(request: NextRequest) {
  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return NextResponse.json(
      { error: "Corps JSON invalide." },
      { status: 400 }
    );
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json(
      { error: "URL produit manquante." },
      { status: 400 }
    );
  }

  try {
    const result = await resolveProduct(url);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[product/resolve]", error);
    const message =
      error instanceof Error ? error.message : "Erreur lors de la résolution.";
    return NextResponse.json({ error: message, source: "unknown" }, { status: 502 });
  }
}
