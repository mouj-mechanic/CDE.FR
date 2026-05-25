import type { CategoryId, PhotoSceneId } from "@/types";

/**
 * Custom GIF / video / image media that overrides the default animated SVG
 * vignette for a given (category, scene) pair.
 *
 * To add a new media:
 *   1. Drop your file into  public/guide/<categoryId>/<sceneId>.<ext>
 *   2. Add a corresponding entry to MEDIA_INDEX below.
 *
 * Supported formats: .png, .jpg, .webp, .gif (image) ; .webm, .mp4 (video).
 * Videos must be muted, autoplay, loop, playsInline — handled by
 * <PhotoStepIllustration />.
 *
 * Fallback: if a file is missing or fails to load, <PhotoStepIllustration />
 * automatically falls back to the procedurally-drawn SVG vignette and emits
 * a console.warn in development.
 */
export type GuideMediaKind = "image" | "video";

export interface GuideMedia {
  src: string;
  kind: GuideMediaKind;
  /** Optional poster image used for video media. */
  poster?: string;
  /**
   * `true` when the asset already contains the step number, title and hint —
   * we render it edge-to-edge and hide the duplicated text column.
   * Default = `false` (the asset is a small illustration combined with text).
   */
  fullCard?: boolean;
}

const MEDIA_INDEX: Partial<
  Record<CategoryId, Partial<Record<PhotoSceneId, GuideMedia>>>
> = {
  headwear: {
    frame:      { src: "/guide/headwear/frame.png",      kind: "image", fullCard: true },
    angle:      { src: "/guide/headwear/angle.png",      kind: "image", fullCard: true },
    lighting:   { src: "/guide/headwear/lighting.png",   kind: "image", fullCard: true },
    background: { src: "/guide/headwear/background.png", kind: "image", fullCard: true },
  },
  glasses: {
    frame:    { src: "/guide/glasses/frame.png",    kind: "image", fullCard: true },
    remove:   { src: "/guide/glasses/remove.png",   kind: "image", fullCard: true },
    angle:    { src: "/guide/glasses/angle.png",    kind: "image", fullCard: true },
    lighting: { src: "/guide/glasses/lighting.png", kind: "image", fullCard: true },
  },
  watch: {
    frame:    { src: "/guide/watch/frame.png",    kind: "image", fullCard: true },
    angle:    { src: "/guide/watch/angle.png",    kind: "image", fullCard: true },
    stable:   { src: "/guide/watch/stable.png",   kind: "image", fullCard: true },
    lighting: { src: "/guide/watch/lighting.png", kind: "image", fullCard: true },
  },
  "hand-jewelry": {
    frame:      { src: "/guide/hand-jewelry/frame.png",      kind: "image", fullCard: true },
    angle:      { src: "/guide/hand-jewelry/angle.png",      kind: "image", fullCard: true },
    background: { src: "/guide/hand-jewelry/background.png", kind: "image", fullCard: true },
    remove:     { src: "/guide/hand-jewelry/remove.png",     kind: "image", fullCard: true },
  },
  clothes: {
    frame:    { src: "/guide/clothes/frame.png",    kind: "image", fullCard: true },
    pose:     { src: "/guide/clothes/pose.png",     kind: "image", fullCard: true },
    outfit:   { src: "/guide/clothes/outfit.png",   kind: "image", fullCard: true },
    lighting: { src: "/guide/clothes/lighting.png", kind: "image", fullCard: true },
  },
};

/**
 * Whether the registered media is a "full card" mockup that already contains
 * the step number, title and hint. When true, the duplicated text column is
 * hidden and the asset is rendered edge-to-edge.
 */
export function isFullCardMedia(
  category: CategoryId,
  scene: PhotoSceneId
): boolean {
  const m = MEDIA_INDEX[category]?.[scene];
  return Boolean(m?.fullCard);
}

export function getGuideMedia(
  category: CategoryId,
  scene: PhotoSceneId
): GuideMedia | null {
  return MEDIA_INDEX[category]?.[scene] ?? null;
}
