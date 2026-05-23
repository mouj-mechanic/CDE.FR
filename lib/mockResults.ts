import type { CategoryId } from "@/types";

/**
 * Mock photo results per category — used when AI_TRYON_PROVIDER is empty.
 * Picsum Photos provides reliable royalty-free portraits via deterministic seeds.
 * Multiple seeds per category give visual variety while remaining stable.
 */
const SEEDS: Record<CategoryId, string[]> = {
  headwear: ["cabines-hat-1", "cabines-hat-2", "cabines-hat-3"],
  glasses: ["cabines-glasses-1", "cabines-glasses-2", "cabines-glasses-3"],
  watch: ["cabines-watch-1", "cabines-watch-2", "cabines-watch-3"],
  "hand-jewelry": ["cabines-jewel-1", "cabines-jewel-2", "cabines-jewel-3"],
  clothes: ["cabines-cloth-1", "cabines-cloth-2", "cabines-cloth-3"],
};

export const MOCK_RESULTS: Record<CategoryId, string[]> = Object.fromEntries(
  Object.entries(SEEDS).map(([id, seeds]) => [
    id,
    seeds.map((s) => `https://picsum.photos/seed/${s}/720/960`),
  ])
) as Record<CategoryId, string[]>;

export function pickMockResult(category: CategoryId): string {
  const list = MOCK_RESULTS[category];
  if (!list || list.length === 0) return "/mock-result.svg";
  return list[Math.floor(Math.random() * list.length)];
}

/** Local fallback if external mock fails to load (offline, blocked, etc.). */
export const MOCK_FALLBACK = "/mock-result.svg";

