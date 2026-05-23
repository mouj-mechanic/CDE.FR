import type { CategoryId } from "@/types";

/**
 * Mock photo results per category — used when AI_TRYON_PROVIDER is empty.
 * High-quality royalty-free photos from Unsplash.
 */
export const MOCK_RESULTS: Record<CategoryId, string[]> = {
  headwear: [
    "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=900&q=80",
    "https://images.unsplash.com/photo-1517423568366-8b83523034fd?w=900&q=80",
    "https://images.unsplash.com/photo-1580522154071-c6ca47a859ee?w=900&q=80",
  ],
  glasses: [
    "https://images.unsplash.com/photo-1577803645773-f96470509666?w=900&q=80",
    "https://images.unsplash.com/photo-1556306535-0f09a537f0a3?w=900&q=80",
    "https://images.unsplash.com/photo-1574258495973-f010dfbb5371?w=900&q=80",
  ],
  watch: [
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=900&q=80",
    "https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=900&q=80",
    "https://images.unsplash.com/photo-1622434641406-a158123450f9?w=900&q=80",
  ],
  "hand-jewelry": [
    "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=900&q=80",
    "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=900&q=80",
    "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=900&q=80",
  ],
  clothes: [
    "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=900&q=80",
    "https://images.unsplash.com/photo-1516762689617-e1cffcef479d?w=900&q=80",
    "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=900&q=80",
  ],
};

export function pickMockResult(category: CategoryId): string {
  const list = MOCK_RESULTS[category];
  if (!list || list.length === 0) return "/mock-result.svg";
  return list[Math.floor(Math.random() * list.length)];
}
