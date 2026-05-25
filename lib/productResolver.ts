import type { ProductResolveResult, ProductSource } from "@/types";

/**
 * Server-side product page resolver — pulls the best product image + title from
 * an arbitrary URL using only `fetch` + lightweight regex/JSON parsing. No
 * dependency on a headless browser or HTML parsing library.
 */

const IMAGE_EXT_RX = /\.(jpe?g|png|webp|gif|avif)(?:\?.*)?(?:#.*)?$/i;
const USER_AGENT =
  "Mozilla/5.0 (compatible; TryWithAIBot/1.0; +https://trywithai.app)";

const FETCH_TIMEOUT_MS = 8000;

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function abortableFetch(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, {
    ...init,
    signal: controller.signal,
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      ...(init?.headers ?? {}),
    },
  }).finally(() => clearTimeout(timeout));
}

function absolutize(base: string, candidate: string | undefined | null): string | undefined {
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return undefined;
  }
}

/** Extract content from <meta property|name="..." content="..."> tags. */
function metaContent(html: string, key: string): string | undefined {
  const rxes = [
    new RegExp(
      `<meta[^>]+property=["']${escapeRegex(key)}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+name=["']${escapeRegex(key)}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    // attribute order can be reversed
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegex(key)}["']`,
      "i"
    ),
  ];
  for (const rx of rxes) {
    const m = html.match(rx);
    if (m && m[1]) return decodeEntities(m[1]);
  }
  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/");
}

/** Pull the first <title> tag. */
function htmlTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1]) return decodeEntities(m[1].trim()).replace(/\s+/g, " ");
  return undefined;
}

/**
 * Parse all <script type="application/ld+json"> blocks and return the first
 * Product schema we find — including image and name.
 */
function findJsonLdProduct(
  html: string,
  base: string
): { title?: string; image?: string } | null {
  const blocks =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ) ?? [];
  for (const block of blocks) {
    const innerMatch = block.match(/>([\s\S]*?)<\/script>/i);
    if (!innerMatch) continue;
    const raw = innerMatch[1].trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const inner = collectProductNodes(node);
      for (const product of inner) {
        const image = pickProductImage(product, base);
        const name = typeof product.name === "string" ? product.name : undefined;
        if (image || name) return { title: name, image };
      }
    }
  }
  return null;
}

interface JsonLdNode {
  "@type"?: string | string[];
  "@graph"?: unknown[];
  image?: unknown;
  name?: unknown;
}

function isProductNode(node: JsonLdNode): boolean {
  const t = node["@type"];
  if (!t) return false;
  if (typeof t === "string") return t === "Product";
  return Array.isArray(t) && t.includes("Product");
}

function collectProductNodes(node: unknown): JsonLdNode[] {
  if (!node || typeof node !== "object") return [];
  const out: JsonLdNode[] = [];
  const n = node as JsonLdNode;
  if (Array.isArray(n["@graph"])) {
    for (const g of n["@graph"]) out.push(...collectProductNodes(g));
  }
  if (isProductNode(n)) out.push(n);
  return out;
}

function pickProductImage(node: JsonLdNode, base: string): string | undefined {
  const img = node.image;
  if (!img) return undefined;
  if (typeof img === "string") return absolutize(base, img);
  if (Array.isArray(img)) {
    for (const v of img) {
      if (typeof v === "string") return absolutize(base, v);
      if (v && typeof v === "object" && "url" in v) {
        return absolutize(base, String((v as { url: unknown }).url));
      }
    }
  }
  if (typeof img === "object" && img && "url" in img) {
    return absolutize(base, String((img as { url: unknown }).url));
  }
  return undefined;
}

interface ShopifyProductJson {
  title?: string;
  featured_image?: string;
  images?: string[];
}

/**
 * Try the Shopify `/products/<handle>.js` JSON endpoint, which gives us the
 * exact product data without parsing HTML.
 */
async function tryShopifyJs(url: string): Promise<ProductResolveResult | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname;
  const productMatch = path.match(/\/products\/([^/?#]+)/);
  if (!productMatch) return null;
  const handle = productMatch[1].replace(/\.html?$/, "");
  const jsUrl = `${parsed.origin}/products/${handle}.js`;

  try {
    const res = await abortableFetch(jsUrl);
    if (!res.ok) return null;
    const data = (await res.json()) as ShopifyProductJson;
    const image =
      absolutize(parsed.origin, data.featured_image) ||
      absolutize(parsed.origin, data.images?.[0]);
    if (!image && !data.title) return null;
    return {
      source: "shopify",
      title: data.title,
      imageUrl: image,
    };
  } catch {
    return null;
  }
}

function looksLikeDirectImage(url: string): boolean {
  try {
    const u = new URL(url);
    return IMAGE_EXT_RX.test(u.pathname);
  } catch {
    return IMAGE_EXT_RX.test(url);
  }
}

/**
 * Main entry: try /products/<handle>.js (Shopify), then parse the HTML for
 * JSON-LD Product schema, og:image, twitter:image, and link rel=image_src.
 */
export async function resolveProduct(
  rawUrl: string
): Promise<ProductResolveResult> {
  const url = rawUrl.trim();
  if (!isHttpUrl(url)) {
    return { source: "unknown" };
  }

  // 1. Direct image URL?
  if (looksLikeDirectImage(url)) {
    return { source: "direct-image", imageUrl: url };
  }

  // 2. Shopify JSON endpoint (fast path for /products/<handle> URLs)
  const shopify = await tryShopifyJs(url);
  if (shopify?.imageUrl) return shopify;

  // 3. Parse HTML server-side
  let html: string;
  try {
    const res = await abortableFetch(url);
    if (!res.ok) return { source: "unknown" };
    // Cap body to ~500KB to stay efficient
    html = (await res.text()).slice(0, 500_000);
  } catch {
    return { source: "unknown" };
  }

  const title =
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    htmlTitle(html);

  const jsonLd = findJsonLdProduct(html, url);

  const candidates: Array<{ url?: string; source: ProductSource }> = [];
  if (jsonLd?.image) candidates.push({ url: jsonLd.image, source: "jsonld" });

  const og = absolutize(url, metaContent(html, "og:image"));
  if (og) candidates.push({ url: og, source: "opengraph" });

  const tw = absolutize(url, metaContent(html, "twitter:image"));
  if (tw) candidates.push({ url: tw, source: "opengraph" });

  // <link rel="image_src" href="...">
  const linkSrc = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
  if (linkSrc && linkSrc[1]) {
    const abs = absolutize(url, linkSrc[1]);
    if (abs) candidates.push({ url: abs, source: "opengraph" });
  }

  const best = candidates.find((c) => !!c.url);
  if (!best?.url) {
    return { source: "unknown", title: title || jsonLd?.title };
  }
  return {
    source: best.source,
    title: title || jsonLd?.title,
    imageUrl: best.url,
  };
}
