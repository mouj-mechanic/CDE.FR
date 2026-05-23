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

export interface Category {
  id: CategoryId;
  label: string;
  shortDescription: string;
  bodyTarget: string;
  photoInstructions: string[];
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

export interface ProductItem {
  id: string;
  type: "url" | "image";
  value: string;
  file?: File;
  previewUrl?: string;
}

export interface TryOnRequest {
  category: CategoryId;
  userImage: File;
  productImages: File[];
  productUrls: string[];
  notes?: string;
}

export interface TryOnResponse {
  resultUrl: string;
  generatedAt: number;
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
  | { type: "SET_RESULT"; resultUrl: string }
  | { type: "RESET_ARTICLES" }
  | { type: "RESET_TRY_AGAIN" }
  | { type: "RESET_ALL" };
