# TryWithAI

> _Try with AI before you buy._
> AI Try-On Widget for Shopify Stores.

TryWithAI is a virtual try-on widget that lets shoppers preview a product on
themselves directly from the Product Detail Page (PDP) of any Shopify store —
no account, no app install, no upload to permanent storage.

This repository is the MVP: a Next.js app that serves both:

- The **B2B landing page** (homepage) targeting Shopify merchants.
- The **try-on experience** (`/embed`) that runs inside an iframe injected by
  a single `<script>` tag on the merchant's PDP.

> The product was previously named **CabinesDEssayage.fr**; the brand is now
> centralised in `lib/brand.ts`. The legacy embed global
> `window.CabinesDEssayage` is still exposed for backward compatibility.

---

## Local setup

```bash
npm install
npm run dev
```

The app runs on http://localhost:3000.

Useful pages while developing:

| Path             | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `/`              | Landing page (hero, demo, pricing, privacy, CTA)         |
| `/demo`          | Fake Shopify PDP with the widget embedded (casquette)    |
| `/demo2`         | Fake PDP — gold & green watch                            |
| `/embed`         | The try-on experience itself (loaded inside the iframe)  |
| `/api/try-on`    | Generation endpoint (mock or fal)                        |
| `/api/product/resolve` | Resolves a product URL → title + best image URL    |

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in what you need.

| Key                       | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `AI_TRYON_PROVIDER`       | `mock` (default), `fal`, or `auto`                                      |
| `FAL_KEY`                 | fal.ai API key — required for `AI_TRYON_PROVIDER=fal`                   |
| `FASHN_API_KEY`           | Optional, reserved for a future direct FASHN integration                |
| `AI_TRYON_API_KEY`        | Legacy generic fallback (also accepted as `FAL_KEY`)                    |
| `NEXT_PUBLIC_AI_PROVIDER` | Mirrors the provider name on the client (used by the privacy note)      |

### Provider modes

- **`mock`** (default): no API key required. Returns a deterministic local
  image (`/demo2-result.png` for watches, otherwise category-specific
  Picsum.photos seeds). Useful to demo the widget without any cost.
- **`fal`**: routes to **fal.ai**.
  - **Clothes** → FASHN (`fashn/tryon/v1.6`, fallback `fal-ai/fashn/tryon`).
    If the FASHN call fails for any reason, the service automatically falls
    back to FLUX Kontext so the user always gets a result.
  - **Headwear / glasses / watch / hand-jewelry** → FLUX Kontext multi-image
    edit (`fal-ai/flux-pro/kontext/max/multi`) with category-specific
    prompts (see `lib/providers/prompts.ts`).
- **`auto`**: uses `fal` if `FAL_KEY` is present, otherwise `mock`. Recommended
  for CI / preview deployments.

---

## Architecture

```
app/
├── api/
│   ├── try-on/route.ts         # Main generation endpoint
│   ├── product/resolve/route.ts # Product URL → image resolver
│   └── download/route.ts       # CORS-safe image proxy
├── embed/page.tsx              # iframe entry point
├── demo/page.tsx               # Demo Shopify PDP (cap)
├── demo2/page.tsx              # Demo Shopify PDP (watch)
├── layout.tsx                  # Root layout + ColorfulBackdrop
└── page.tsx                    # Landing page

components/
├── sections/                   # Landing page sections
│   ├── HowItWorks.tsx
│   ├── ShopifyIntegration.tsx
│   ├── Pricing.tsx
│   ├── PrivacySection.tsx
│   ├── FinalCTA.tsx
│   └── DemoSection.tsx
├── EmbedExperience.tsx         # iframe shell + flow router
├── EmbedFlow.tsx               # Auto-flow when product is detected
├── TryOnPanel.tsx              # Manual wizard (photo → product → launch)
├── ProductInput.tsx            # URL resolver + dropzone
├── ImageUploader.tsx
├── PhotoGuideSteps.tsx         # Animated step-by-step photo guide
├── PhotoStepIllustration.tsx   # Per-step illustration with media fallback
├── PhotoQualityChecklist.tsx   # Client-side validation
├── ConsentCheckbox.tsx         # Required before generation
├── ResultView.tsx              # Provider badge, download, share, retry
└── ...

lib/
├── brand.ts                    # Single source of truth for brand strings
├── categories.ts               # 5 categories + photo steps
├── tryOnService.ts             # Provider router (mock | fal)
├── providers/
│   ├── falKontext.ts           # FLUX Kontext multi-image
│   ├── fashn.ts                # FASHN clothes specialist
│   └── prompts.ts              # Category-specific prompts + negatives
├── productResolver.ts          # Shopify /.js + JSON-LD + OG parser
├── photoQuality.ts             # Heuristic dimension/brightness/blur checks
├── usage.ts                    # Internal usage event tracker (TODO: db)
├── mockResults.ts              # Picsum seeds + local overrides
├── detectCategory.ts           # Title → CategoryId heuristics
├── guideMedia.ts               # Optional custom GIF/video index
└── tryOnReducer.ts             # useReducer state for the wizard

public/
├── embed.js                    # Shopify widget loader (vanilla JS)
├── guide/<category>/*.png      # Optional custom step illustrations
└── ...
```

---

## Shopify embed setup

Add this single tag to your `theme.liquid`, just before `</body>`:

```html
<script
  src="https://trywithai.app/embed.js"
  data-app-url="https://trywithai.app"
  data-label="Essayer avec l'IA"
  data-delay="1500"
  data-color="#7C3AED"
  data-pages="product"
  data-merchant-id="your-shop-id"
  async
></script>
```

### Script attributes

| Attribute             | Default            | Description                                                            |
| --------------------- | ------------------ | ---------------------------------------------------------------------- |
| `data-app-url`        | `window.origin`    | Origin of the TryWithAI app (your deployment)                          |
| `data-label`          | `Essayer avec l'IA`| Bubble label on desktop                                                |
| `data-delay`          | `1500`             | Milliseconds before the bubble appears                                 |
| `data-position`       | `right`            | `right` or `left`                                                      |
| `data-color`          | `#7C3AED`          | Base color of the bubble background                                    |
| `data-pages`          | `product`          | Comma list of `product`, `collection`, `home`, or `all`                |
| `data-category`       | _(empty)_          | Force a specific category (`headwear`, `glasses`, `watch`, `hand-jewelry`, `clothes`) |
| `data-merchant-id`    | _(empty)_          | Identifies the merchant in usage logs                                  |
| `data-product-image`  | _(empty)_          | Override the detected product image URL                                |

### JavaScript API

Both globals are exposed (backward compat):

```js
window.TryWithAI.open();   // alias: window.CabinesDEssayage.open()
window.TryWithAI.close();
window.TryWithAI.show();   // show bubble if hidden
window.TryWithAI.hide();   // remove bubble
```

The widget auto-detects the product image and title from:

1. `<script data-product-image>` attribute (explicit override)
2. `window.ShopifyAnalytics.meta.product`
3. JSON-LD `Product` schema
4. `og:image`, `twitter:image`, `link[rel=image_src]`
5. DOM scan of `[data-product-featured-image]`, `.product-single__photos`,
   `.product__media`, `.product-gallery`, etc., using `srcset` and largest
   image scoring.

---

## Photo guide media

`PhotoGuideSteps` plays an animated step-by-step guide tailored to the body
part being targeted. Each step has a procedurally-drawn SVG illustration by
default, which can be overridden with a custom GIF / WebM / MP4 / PNG.

To override a step:

1. Drop your file in `public/guide/<categoryId>/<sceneId>.<ext>`
2. Add it to `lib/guideMedia.ts`:

```ts
const MEDIA_INDEX = {
  headwear: {
    frame: { src: "/guide/headwear/frame.png", kind: "image", fullCard: true },
  },
};
```

If the file is missing or fails to load at runtime, the component automatically
falls back to the SVG and emits a `console.warn` in development. See
`public/guide/README.md` for the full convention.

---

## Known limitations (MVP)

- No authentication, no merchant dashboard, no Stripe billing.
- Usage events are logged to stdout only — not persisted yet.
- Photo quality validation is heuristic (canvas-based brightness/blur). No
  computer-vision body-part detection.
- Shopify integration uses a script tag, not the official Shopify App Bridge.
- Privacy: images are sent to fal.ai when `AI_TRYON_PROVIDER=fal`. They are
  not stored by this app, but the provider has its own retention policy.

---

## Production TODOs

- [ ] Merchant accounts + Shopify OAuth install flow
- [ ] Stripe billing (metered + quota enforcement)
- [ ] Postgres for `try_on_events` + `merchants` (see `lib/usage.ts`)
- [ ] Merchant dashboard (usage, conversion, A/B)
- [ ] GDPR / legal pages, Shopify privacy compliance
- [ ] Computer-vision based category & body-part validation
- [ ] Webhook to push conversion back to Shopify

---

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run lint:fix
```

> **Windows CMD / PowerShell:** do not paste inline comments after commands
> (e.g. `npm run build # comment`). On Windows, `#` is passed as an argument
> and Next.js will look for a folder named `#`. Run each command on its own line.

---

## License

Proprietary — TryWithAI MVP. © {YEAR} TryWithAI.
