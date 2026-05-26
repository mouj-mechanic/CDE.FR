export type CategoryId =
  | "headwear"
  | "watch"
  | "hand-jewelry"
  | "clothes"
  | "glasses";

export type ProductInputMode = "single" | "multi";

export type AnimationType =
  | "hatmaker"
  | "watchmaker"
  | "jeweler"
  | "tailor"
  | "optician";

export type IconName =
  | "hat"
  | "watch"
  | "gem"
  | "shirt"
  | "glasses";

/** Visual scene played in the animated photo guide for a single step. */
export type PhotoSceneId =
  | "frame"      // Frame the body part / set distance
  | "angle"      // Hold the right angle
  | "lighting"   // Soft, even, natural light
  | "background" // Plain neutral background
  | "remove"     // Remove existing accessory (e.g. glasses)
  | "stable"     // Stay still, no motion blur
  | "pose"       // Stand straight / posture
  | "outfit";    // Wear something fitted underneath

export interface PhotoStep {
  /** Short, action-oriented title shown as the step header. */
  title: string;
  /** One-sentence elaboration shown under the title. */
  hint: string;
  /** Which scene to render in the central animated illustration. */
  scene: PhotoSceneId;
}

export interface Category {
  id: CategoryId;
  label: string;
  shortDescription: string;
  bodyTarget: string;
  /** Legacy plain instructions (kept for backward compatibility). */
  photoInstructions: string[];
  /** Step-by-step animated guide. */
  photoSteps: PhotoStep[];
  productInputMode: ProductInputMode;
  loadingTitle: string;
  loadingDescription: string;
  animationType: AnimationType;
  iconName: IconName;
}

export type WizardStep = 1 | 2 | 3;

export type TryOnStatus =
  | "idle"
  | "validating"
  | "loading"
  | "revealing"
  | "done"
  | "error";

export type ProductSource =
  | "user"
  | "shopify"
  | "opengraph"
  | "jsonld"
  | "direct-image"
  | "unknown";

export interface ProductItem {
  id: string;
  type: "url" | "image";
  value: string;
  file?: File;
  previewUrl?: string;
  source?: ProductSource;
  title?: string;
  /** Transparent PNG cutout URL, produced by /api/product/cutout. */
  cutoutUrl?: string;
  /** Whether the cutout is currently being computed. */
  cutoutPending?: boolean;
  /** Last cutout error message, if any. */
  cutoutError?: string;
}

export type FingerId = "index" | "middle" | "ring" | "pinky";
export type HandJewelryType = "ring" | "bracelet";

export interface TryOnRequest {
  category: CategoryId;
  userImage: File;
  productImages: File[];
  productUrls: string[];
  notes?: string;
  merchantId?: string;
  /** Optional deterministic preview produced client-side. */
  previewImage?: File;
  /** Hand-jewelry subtype (ring | bracelet). */
  handJewelryType?: HandJewelryType;
  /** Target finger for rings. */
  ringFinger?: FingerId;
  /** Render mode requested by the client. */
  renderModeRequest?: "fast" | "premium" | "auto";
  /**
   * Inpainting refinement pack. When both fields are provided, the
   * service routes to a mask-aware model:
   *  - openai → gpt-image-1 image edit with alpha mask.
   *  - fal    → FLUX Fill / FLUX LoRA Inpainting.
   * Unmasked pixels are preserved exactly — protecting product details
   * and hand/face anatomy.
   */
  inpaintComposite?: File;
  inpaintMask?: File;
}

export interface TryOnResponseDebug {
  imageCount: number;
  productImageCount: number;
  productWasCutout?: boolean;
  productImageSource?: "transparent-upload" | "cutout" | "original";
  productHasAlpha?: boolean;
  productMimeType?: string;
  /** True when the request was handled by the OpenAI provider. */
  usedOpenAI?: boolean;
  /** True when the request was handled by a fal.ai model. */
  usedFal?: boolean;
  /**
   * True when the API returned a locally rendered image (fast-overlay /
   * canvas) as the *final* result. In API-only mode this must always be
   * false.
   */
  usedLocalRenderer?: boolean;
  /** Whether an OpenAI alpha mask was attached to the edit call. */
  maskUsed?: boolean;
}

export type RenderMode =
  | "fast-overlay"
  | "premium-ai"
  | "specialized-vton"
  | "api-image-edit"
  | "mock";

export type QualityStatus =
  | "passed"
  | "fallback-preview"
  | "needs-better-photo"
  | "needs-manual-adjustment"
  | "alpha-lost"
  | "failed";

export interface TryOnWarning {
  code: string;
  message: string;
}

export interface WatchPlacementResponse {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  curvature: number;
  confidence: number;
}

export interface TryOnResponse {
  resultUrl: string;
  /** Optional client-side deterministic preview, if any. */
  previewUrl?: string;
  generatedAt: number;
  mock?: boolean;
  provider?: string;
  model?: string;
  category?: CategoryId;
  /** Server-side generation duration in milliseconds. */
  durationMs?: number;
  /** Debug counts. Only safe scalars — never URLs or PII. */
  debug?: TryOnResponseDebug;
  renderMode?: RenderMode;
  qualityStatus?: QualityStatus;
  warnings?: TryOnWarning[];
  /** Watch-only: placement actually used for the deterministic overlay. */
  placement?: WatchPlacementResponse;
  /** Watch-only: alpha edge-quality score in [0..1]. */
  edgeQuality?: number;
}

export interface ProductResolveResult {
  title?: string;
  imageUrl?: string;
  source: ProductSource;
}

export interface TryOnResultMeta {
  provider?: string;
  model?: string;
  mock?: boolean;
  renderMode?: RenderMode;
  qualityStatus?: QualityStatus;
  warnings?: TryOnWarning[];
  /** Mirror of debug.maskUsed for UI consumption. */
  maskUsed?: boolean;
  /** Mirror of debug.usedLocalRenderer for UI consumption. */
  usedLocalRenderer?: boolean;
}

export interface TryOnState {
  step: WizardStep;
  userImage: File | null;
  userImagePreview: string | null;
  products: ProductItem[];
  notes: string;
  status: TryOnStatus;
  error: string | null;
  resultUrl: string | null;
  resultMeta: TryOnResultMeta | null;
}

export type TryOnAction =
  | { type: "SET_STEP"; step: WizardStep }
  | { type: "SET_USER_IMAGE"; file: File; previewUrl: string }
  | { type: "CLEAR_USER_IMAGE" }
  | { type: "ADD_PRODUCT"; product: ProductItem }
  | {
      type: "UPDATE_PRODUCT";
      id: string;
      patch: Partial<Omit<ProductItem, "id">>;
    }
  | { type: "REMOVE_PRODUCT"; id: string }
  | { type: "CLEAR_PRODUCTS" }
  | { type: "SET_NOTES"; notes: string }
  | { type: "SET_STATUS"; status: TryOnStatus }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_RESULT"; resultUrl: string; meta?: TryOnResultMeta }
  | { type: "RESET_ARTICLES" }
  | { type: "RESET_TRY_AGAIN" }
  | { type: "RESET_ALL" };
