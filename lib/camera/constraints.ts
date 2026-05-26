/**
 * Build the cascade of `MediaStreamConstraints` to try when opening the
 * camera. iOS Safari is allergic to overly-specific constraints (most
 * commonly `facingMode: { exact: ... }`), so we always start with
 * "ideal" hints and degrade down to `video: true` — which works on
 * every browser that supports getUserMedia at all.
 *
 *  This is extracted to its own module so it can be unit-tested
 *  outside a DOM environment.
 */
export type CameraFacingMode = "user" | "environment";

export function buildCameraConstraintsCascade(
  mode: CameraFacingMode
): MediaStreamConstraints[] {
  return [
    {
      audio: false,
      video: {
        facingMode: { ideal: mode },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    },
    { audio: false, video: { facingMode: mode } },
    { audio: false, video: true },
  ];
}

/**
 * Map a `DOMException.name` to the customer-facing copy that
 * `CameraCapture` should render. Centralised so we never leak the raw
 * error name to the UI.
 */
export function cameraErrorMessageFromName(name: string): string {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Accès à la caméra refusé. Autorisez la caméra dans les réglages du navigateur, ou importez une photo.";
    case "NotFoundError":
      return "Aucune caméra détectée sur cet appareil. Importez plutôt une photo.";
    case "NotReadableError":
    case "TrackStartError":
      return "La caméra est utilisée par une autre application. Fermez-la puis réessayez.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Cette caméra ne supporte pas les réglages demandés. Importez plutôt une photo.";
    default:
      return "Impossible d'ouvrir la caméra sur ce navigateur. Importez plutôt une photo.";
  }
}

/**
 * Detect whether the current execution context can actually use
 * `getUserMedia`. Returns a tag that the UI uses to pick between
 * "live camera", "insecure" and "fallback" code paths.
 */
export function detectCameraCapability(env: {
  isSecureContext?: boolean;
  hasMediaDevices?: boolean;
  hasGetUserMedia?: boolean;
}): "ok" | "insecure" | "unsupported" {
  if (!env.isSecureContext) return "insecure";
  if (!env.hasMediaDevices || !env.hasGetUserMedia) return "unsupported";
  return "ok";
}
