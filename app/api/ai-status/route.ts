import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const provider = process.env.AI_TRYON_PROVIDER || "mock";
  const publicProvider = process.env.NEXT_PUBLIC_AI_PROVIDER || "not-set";
  const hasFalKey = Boolean(process.env.FAL_KEY);

  const mode =
    provider === "fal" && hasFalKey
      ? "real-ai"
      : provider === "fal" && !hasFalKey
        ? "fal-configured-but-missing-key"
        : "mock";

  return NextResponse.json({
    ok: provider === "fal" ? hasFalKey : true,
    provider,
    publicProvider,
    hasFalKey,
    mode,
  });
}