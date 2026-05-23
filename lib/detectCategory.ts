import type { CategoryId } from "@/types";

const KEYWORDS: Record<CategoryId, RegExp[]> = {
  headwear: [
    /casquette/i,
    /chapeau/i,
    /bonnet/i,
    /b[ée]ret/i,
    /b[ée]ret/i,
    /\bhat\b/i,
    /\bcap\b/i,
    /beanie/i,
    /headband/i,
    /tuque/i,
  ],
  glasses: [
    /lunettes?/i,
    /monture/i,
    /optique/i,
    /\bglasses\b/i,
    /eyewear/i,
    /sunglasses/i,
    /solaires?/i,
  ],
  watch: [
    /\bmontre\b/i,
    /\bwatch\b/i,
    /horlogerie/i,
    /timepiece/i,
    /chronographe/i,
    /chronograph/i,
  ],
  "hand-jewelry": [
    /\bbague\b/i,
    /\bbracelet\b/i,
    /jonc\b/i,
    /\branneau\b/i,
    /\bring\b/i,
    /\bbangle\b/i,
    /joaillerie/i,
    /jewelry/i,
    /bijou/i,
  ],
  clothes: [
    /v[êe]tement/i,
    /robe/i,
    /\bdress\b/i,
    /t-?shirt/i,
    /chemise/i,
    /\bshirt\b/i,
    /pull/i,
    /sweat/i,
    /pantalon/i,
    /jean/i,
    /short/i,
    /jupe/i,
    /\bskirt\b/i,
    /veste/i,
    /jacket/i,
    /manteau/i,
    /coat/i,
    /blouse/i,
    /hoodie/i,
    /\bpolo\b/i,
    /cardigan/i,
    /\btop\b/i,
    /débardeur/i,
    /maillot/i,
  ],
};

const DEFAULT_CATEGORY: CategoryId = "clothes";

export function detectCategoryFromTitle(
  title: string | null | undefined
): CategoryId {
  if (!title) return DEFAULT_CATEGORY;
  for (const [id, patterns] of Object.entries(KEYWORDS) as [
    CategoryId,
    RegExp[],
  ][]) {
    if (patterns.some((rx) => rx.test(title))) return id;
  }
  return DEFAULT_CATEGORY;
}
