import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Diagnostic endpoint. Reports which AI provider is configured and whether
 * the matching credential is present. Never returns the secret itself.
 *
 * Response shape (matches the OpenAI integration spec):
 *   {
 *     provider,
 *     publicProvider,
 *     hasOpenAIKey,
 *     hasFalKey,
 *     openaiModel,
 *     mode
 *   }
 */
export async function GET() {
  const provider = process.env.AI_TRYON_PROVIDER || "mock";
  const publicProvider = process.env.NEXT_PUBLIC_AI_PROVIDER || "not-set";
  const hasFalKey = Boolean(process.env.FAL_KEY);
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  const openaiModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

  let mode:
    | "real-ai-openai"
    | "real-ai-fal"
    | "fal-configured-but-missing-key"
    | "openai-configured-but-missing-key"
    | "mock";

  if (provider === "openai") {
    mode = hasOpenAIKey
      ? "real-ai-openai"
      : "openai-configured-but-missing-key";
  } else if (provider === "fal") {
    mode = hasFalKey ? "real-ai-fal" : "fal-configured-but-missing-key";
  } else if (provider === "auto") {
    mode = hasOpenAIKey
      ? "real-ai-openai"
      : hasFalKey
        ? "real-ai-fal"
        : "mock";
  } else {
    mode = "mock";
  }

  const ok =
    mode === "real-ai-openai" || mode === "real-ai-fal" || mode === "mock";

  return NextResponse.json({
    ok,
    provider,
    publicProvider,
    hasOpenAIKey,
    hasFalKey,
    openaiModel,
    mode,
  });
}
