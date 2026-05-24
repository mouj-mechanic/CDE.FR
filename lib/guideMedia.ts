import type { CategoryId, PhotoSceneId } from "@/types";

/**
 * Custom GIF / video media that overrides the default animated SVG vignette
 * for a given (category, scene) pair.
 *
 * To add a media:
 *   1. Drop your file into  public/guide/<categoryId>/<sceneId>.<ext>
 *   2. Add it to MEDIA_INDEX below (or follow the convention by exporting a
 *      list of available files via getGuideMedia).
 *
 * Supported formats: .gif, .webp (animated), .webm, .mp4 (muted, autoplay,
 * loop). MP4 / WebM produce smaller files than GIF and are preferred for
 * any clip larger than ~1 MB.
 */
export type GuideMediaKind = "image" | "video";

export interface GuideMedia {
  src: string;
  kind: GuideMediaKind;
  /** Optional poster image used for video media. */
  poster?: string;
}

/**
 * Manual map. Edit this when you add new GIFs.
 * The convention used here is `/guide/<category>/<scene>.<ext>` so we just
 * need the extension. Set `null` (or remove the entry) to fall back to the
 * default SVG animation.
 */
const MEDIA_INDEX: Partial<
  Record<CategoryId, Partial<Record<PhotoSceneId, GuideMedia>>>
> = {
  headwear: {
    frame:      { src: "/guide/headwear/frame.png",      kind: "image" },
    angle:      { src: "/guide/headwear/angle.png",      kind: "image" },
    lighting:   { src: "/guide/headwear/lighting.png",   kind: "image" },
    background: { src: "/guide/headwear/background.png", kind: "image" },
  },
  glasses: {
    frame:    { src: "/guide/glasses/frame.png",    kind: "image" },
    remove:   { src: "/guide/glasses/remove.png",   kind: "image" },
    angle:    { src: "/guide/glasses/angle.png",    kind: "image" },
    lighting: { src: "/guide/glasses/lighting.png", kind: "image" },
  },
  watch: {
    frame:    { src: "/guide/watch/frame.png",    kind: "image" },
    angle:    { src: "/guide/watch/angle.png",    kind: "image" },
    stable:   { src: "/guide/watch/stable.png",   kind: "image" },
    lighting: { src: "/guide/watch/lighting.png", kind: "image" },
  },
  "hand-jewelry": {
    frame:      { src: "/guide/hand-jewelry/frame.png",      kind: "image" },
    angle:      { src: "/guide/hand-jewelry/angle.png",      kind: "image" },
    background: { src: "/guide/hand-jewelry/background.png", kind: "image" },
    remove:     { src: "/guide/hand-jewelry/remove.png",     kind: "image" },
  },
  clothes: {
    frame:    { src: "/guide/clothes/frame.png",    kind: "image" },
    pose:     { src: "/guide/clothes/pose.png",     kind: "image" },
    outfit:   { src: "/guide/clothes/outfit.png",   kind: "image" },
    lighting: { src: "/guide/clothes/lighting.png", kind: "image" },
  },
};

/**
 * Whether the registered media is a "full card" mockup (already contains the
 * step number, title, hint, etc.) or just a vignette to be combined with the
 * default text layout. Full cards are rendered edge-to-edge and the
 * duplicated text column is hidden.
 *
 * Default = "full" because the current images we ship are full mockups.
 */
export function isFullCardMedia(
  category: CategoryId,
  scene: PhotoSceneId
): boolean {
  return Boolean(MEDIA_INDEX[category]?.[scene]);
}

export function getGuideMedia(
  category: CategoryId,
  scene: PhotoSceneId
): GuideMedia | null {
  return MEDIA_INDEX[category]?.[scene] ?? null;
}
