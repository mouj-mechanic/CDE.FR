import type { CategoryId } from "@/types";

/**
 * Shared types for the controlled try-on pipeline.
 *
 * The pipeline is split into:
 *  - Client-side landmark detection (MediaPipe in browser)
 *  - Pure placement math (`placement.ts`)
 *  - Deterministic compositing on `<canvas>` (`canvasRender.ts`)
 *  - Optional AI refinement using the deterministic preview as a base
 *  - Pre/post quality validation
 */

export type RenderMode =
  | "fast-overlay" // deterministic canvas compositing only — zero AI cost
  | "premium-ai"   // deterministic preview + fal AI refinement
  | "specialized-vton" // FASHN / dedicated clothes model
  | "mock";        // default placeholder image

export type RenderModeRequest = "fast" | "premium" | "auto";

export type ProductImageSource =
  | "transparent-upload"
  | "cutout"
  | "original";

export type QualityStatus =
  | "passed"
  | "fallback-preview"
  | "needs-better-photo"
  | "failed"
  | "alpha-lost";

export type FingerId = "index" | "middle" | "ring" | "pinky";

export type HandJewelryType = "ring" | "bracelet";

export interface LandmarkPoint {
  /** Normalized x in [0,1] (left = 0). */
  x: number;
  /** Normalized y in [0,1] (top = 0). */
  y: number;
  z?: number;
  visibility?: number;
}

export interface TryOnLandmarks {
  category: CategoryId;
  /** Normalized image size used for detection. */
  imageWidth: number;
  imageHeight: number;
  face?: LandmarkPoint[];
  hand?: LandmarkPoint[];
  pose?: LandmarkPoint[];
  /** "Right"/"Left" as labeled by MediaPipe (mirrored vs. user). */
  handedness?: "Left" | "Right" | "unknown";
}

/**
 * Deterministic placement of a product over the user photo. All values are
 * in pixels of the *full-resolution* user image.
 */
export interface Placement {
  /** Center X of the placed product (pixels). */
  cx: number;
  /** Center Y of the placed product (pixels). */
  cy: number;
  /** Final width to draw the product at (pixels). */
  width: number;
  /** Final height to draw the product at (pixels). */
  height: number;
  /** Rotation in radians, applied around (cx, cy). */
  rotation: number;
  /** Optional drop-shadow strength multiplier [0..1]. */
  shadow?: number;
  /** Diagnostic — what we anchored on (eye span, wrist axis, etc.). */
  anchor?: string;
}

/**
 * Rectangular mask describing the region the AI is allowed to refine.
 */
export interface RefinementMask {
  /** Top-left X of the masked region (pixels). */
  x: number;
  /** Top-left Y of the masked region (pixels). */
  y: number;
  /** Width of the masked region (pixels). */
  width: number;
  /** Height of the masked region (pixels). */
  height: number;
  /** Rotation in radians (counter-clockwise). */
  rotation: number;
}

export interface PipelineWarning {
  code:
    | "landmarks-missing"
    | "low-confidence"
    | "product-not-transparent"
    | "product-alpha-lost"
    | "tight-crop"
    | "off-axis"
    | "premium-validation-failed"
    | "remove-existing-accessory";
  message: string;
}

export interface WatchPlacementDescriptor {
  /** Watch centre on the user image, in pixels. */
  x: number;
  y: number;
  /** Watch width in pixels at the auto/used scale. */
  width: number;
  /** Watch height in pixels at the auto/used scale. */
  height: number;
  /** Scale multiplier applied to the auto width (1 = auto). */
  scale: number;
  /** Rotation around (x, y) in radians. */
  rotation: number;
  /** Curvature in [0..1] used for the cylindrical warp. */
  curvature: number;
  /** Detection confidence in [0..1] (0 when no landmarks). */
  confidence: number;
}

export interface PipelineResult {
  /** Local object URL of the deterministic preview. */
  previewBlobUrl: string;
  previewBlob: Blob;
  placement: Placement | null;
  landmarks: TryOnLandmarks | null;
  warnings: PipelineWarning[];
  qualityStatus: QualityStatus;
  renderMode: RenderMode;
  /** Whether the product image bitmap had a meaningful alpha channel. */
  productHasAlpha: boolean;
  /** Best-effort MIME type used for the product image (e.g. "image/png"). */
  productMimeType: string;
  /** Where the product image came from. */
  productImageSource: ProductImageSource;
  /** Watch-specific placement (only set for the watch category). */
  watchPlacement?: WatchPlacementDescriptor;
  /** Edge-quality score [0..1] from the alpha refiner (watch only). */
  edgeQuality?: number;
  /**
   * Watch-only: black + white contact-band mask aligned with the composite.
   * Sent alongside the composite to the inpainting backend so FLUX Fill
   * only repaints the watch contour, leaving the dial untouched.
   */
  maskBlob?: Blob;
  maskBlobUrl?: string;
}

export interface PipelineOptions {
  category: CategoryId;
  userFile: File;
  productFile: File | null;
  productUrl?: string | null;
  /** Transparent PNG cutout. Preferred over `productFile`/`productUrl`. */
  productCutoutUrl?: string | null;
  mode: RenderModeRequest;
  /** Required when category === "hand-jewelry". Default: "ring". */
  handJewelryType?: HandJewelryType;
  /** Required for rings. Default: "ring" finger. */
  ringFinger?: FingerId;
  /** Manual watch adjustments (offset/scale/rotation/curvature/shadow). */
  watchAdjustments?: Partial<{
    offsetX: number;
    offsetY: number;
    scale: number;
    rotation: number;
    curvature: number;
    shadowIntensity: number;
  }>;
}

/** Map a MediaPipe finger to its landmark index range (proximal..tip). */
export const FINGER_LANDMARKS: Record<
  FingerId,
  { mcp: number; pip: number; dip: number; tip: number }
> = {
  index: { mcp: 5, pip: 6, dip: 7, tip: 8 },
  middle: { mcp: 9, pip: 10, dip: 11, tip: 12 },
  ring: { mcp: 13, pip: 14, dip: 15, tip: 16 },
  pinky: { mcp: 17, pip: 18, dip: 19, tip: 20 },
};

export const HAND_LANDMARK_WRIST = 0;
export const HAND_LANDMARK_THUMB_CMC = 1;
export const HAND_LANDMARK_INDEX_MCP = 5;
export const HAND_LANDMARK_PINKY_MCP = 17;
