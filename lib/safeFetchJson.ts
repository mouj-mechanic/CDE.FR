/**
 * Tolerant JSON fetch wrapper.
 *
 * Some failure paths (Vercel 413 "Request Entity Too Large", upstream proxy
 * errors, HTML error pages) don't return JSON. Calling `response.json()`
 * directly throws "Unexpected token 'R'…" which is opaque to the user.
 *
 * `safeFetchJson` always reads the body as text first, attempts JSON
 * parsing, and on failure surfaces a human-readable error with the HTTP
 * status code.
 */

export interface SafeFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string | null;
  /** True when the response body wasn't valid JSON. */
  nonJson: boolean;
  errorMessage: string | null;
}

export async function safeFetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<SafeFetchResult<T>> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      rawText: null,
      nonJson: false,
      errorMessage:
        err instanceof Error ? err.message : "Erreur réseau inconnue.",
    };
  }

  const rawText = await response.text();
  if (!rawText) {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      rawText: "",
      nonJson: false,
      errorMessage: response.ok ? null : friendlyStatusMessage(response.status),
    };
  }

  try {
    const data = JSON.parse(rawText) as T;
    return {
      ok: response.ok,
      status: response.status,
      data,
      rawText,
      nonJson: false,
      errorMessage: response.ok ? null : null,
    };
  } catch {
    return {
      ok: false,
      status: response.status,
      data: null,
      rawText,
      nonJson: true,
      errorMessage: friendlyStatusMessage(response.status, rawText),
    };
  }
}

function friendlyStatusMessage(status: number, rawText?: string): string {
  if (status === 413 || /request entity too large/i.test(rawText ?? "")) {
    return "Les images envoyées sont trop volumineuses. Réessayez avec une photo moins lourde.";
  }
  if (status === 504 || status === 408) {
    return "Le serveur a mis trop de temps à répondre. Réessayez dans quelques secondes.";
  }
  if (status === 502 || status === 503) {
    return "Le service est temporairement indisponible. Réessayez dans quelques secondes.";
  }
  if (status === 0) {
    return "Connexion réseau interrompue. Vérifiez votre connexion et réessayez.";
  }
  if (status >= 500) {
    return "Erreur serveur inattendue. Réessayez ou contactez le support si le problème persiste.";
  }
  if (status >= 400) {
    return "La requête a été rejetée par le serveur.";
  }
  return "Réponse inattendue du serveur.";
}
