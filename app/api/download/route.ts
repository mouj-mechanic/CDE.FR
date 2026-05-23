import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_HOSTS = [
  "fal.media",
  "v2.fal.media",
  "v3.fal.media",
];

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "URL manquante." }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL invalide." }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "Seules les URL HTTPS sont autorisées." },
      { status: 400 }
    );
  }

  const isAllowed =
    ALLOWED_HOSTS.includes(parsed.hostname) ||
    parsed.hostname.endsWith(".fal.media");
  if (!isAllowed) {
    return NextResponse.json(
      { error: "Domaine non autorisé." },
      { status: 403 }
    );
  }

  const upstream = await fetch(parsed.toString());
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Impossible de récupérer le fichier." },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
    },
  });
}
