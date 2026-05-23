import type { TryOnAction, TryOnState } from "@/types";

export const initialTryOnState: TryOnState = {
  step: 1,
  userImage: null,
  userImagePreview: null,
  products: [],
  notes: "",
  status: "idle",
  error: null,
  resultUrl: null,
};

export function tryOnReducer(
  state: TryOnState,
  action: TryOnAction
): TryOnState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step, error: null };
    case "SET_USER_IMAGE":
      return {
        ...state,
        userImage: action.file,
        userImagePreview: action.previewUrl,
        error: null,
      };
    case "CLEAR_USER_IMAGE":
      if (state.userImagePreview) {
        URL.revokeObjectURL(state.userImagePreview);
      }
      return {
        ...state,
        userImage: null,
        userImagePreview: null,
      };
    case "ADD_PRODUCT":
      return {
        ...state,
        products: [...state.products, action.product],
        error: null,
      };
    case "REMOVE_PRODUCT": {
      const removed = state.products.find((p) => p.id === action.id);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return {
        ...state,
        products: state.products.filter((p) => p.id !== action.id),
      };
    }
    case "CLEAR_PRODUCTS":
      state.products.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      return { ...state, products: [] };
    case "SET_NOTES":
      return { ...state, notes: action.notes };
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "SET_ERROR":
      return {
        ...state,
        error: action.error,
        status: action.error ? "error" : "idle",
      };
    case "SET_RESULT":
      return {
        ...state,
        resultUrl: action.resultUrl,
        status: "revealing",
        error: null,
      };
    case "RESET_ARTICLES":
      state.products.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      return {
        ...state,
        products: [],
        step: 3,
        status: "idle",
        error: null,
        resultUrl: null,
      };
    case "RESET_TRY_AGAIN":
      state.products.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      return {
        ...state,
        products: [],
        step: 1,
        status: "idle",
        error: null,
        resultUrl: null,
      };
    case "RESET_ALL":
      if (state.userImagePreview) {
        URL.revokeObjectURL(state.userImagePreview);
      }
      state.products.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      return { ...initialTryOnState };
    default:
      return state;
  }
}
