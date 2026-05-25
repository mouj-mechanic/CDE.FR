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
}

export interface TryOnRequest {
  category: CategoryId;
  userImage: File;
  productImages: File[];
  productUrls: string[];
  notes?: string;
  merchantId?: string;
}

export interface TryOnResponse {
  resultUrl: string;
  generatedAt: number;
  mock?: boolean;
  provider?: string;
  model?: string;
  category?: CategoryId;
  /** Server-side generation duration in milliseconds. */
  durationMs?: number;
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
  | { type: "REMOVE_PRODUCT"; id: string }
  | { type: "CLEAR_PRODUCTS" }
  | { type: "SET_NOTES"; notes: string }
  | { type: "SET_STATUS"; status: TryOnStatus }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_RESULT"; resultUrl: string; meta?: TryOnResultMeta }
  | { type: "RESET_ARTICLES" }
  | { type: "RESET_TRY_AGAIN" }
  | { type: "RESET_ALL" };
