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
| `/api/ai-status` | Diagnostic — reports active provider and key presence    |
| `/api/product/resolve` | Resolves a product URL → title + best image URL    |

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in what you need.

| Key                          | Purpose                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `AI_TRYON_PROVIDER`          | `mock` (default), `openai`, `fal`, or `auto`                                     |
| `TRYON_RENDER_MODE`          | `auto` (default), `fast`, `premium`, or **`api-only`**                           |
| `DISABLE_LOCAL_RENDER`       | `true` to forbid any local renderer as the final image (no fast-overlay fallback)|
| `OPENAI_API_KEY`             | OpenAI API key — required for `AI_TRYON_PROVIDER=openai`                         |
| `OPENAI_IMAGE_MODEL`         | Optional, defaults to `gpt-image-1`                                              |
| `OPENAI_IMAGE_SIZE`          | `1024x1024` (default), `1024x1536`, `1536x1024`, or `auto`                       |
| `OPENAI_IMAGE_QUALITY`       | `low` / `medium` / `high` (default) / `auto`                                     |
| `OPENAI_IMAGE_OUTPUT_FORMAT` | `png` (default), `jpeg`, `webp`. PNG preserves alpha edges                       |
| `OPENAI_INPUT_FIDELITY`      | `high` (default) / `low`. `high` keeps the customer's pose/hand untouched       |
| `OPENAI_USE_MASKED_EDIT`     | `true` (default). When `false`, the API skips the alpha mask                     |
| `REQUIRE_MASK_FOR_OPENAI`    | `false` (default). **Customers never upload masks** — keep `false` in production |
| `NEXT_PUBLIC_REQUIRE_MASK_FOR_OPENAI` | Mirror the above on the client (should stay `false`)                      |
| `OPENAI_AUTO_MASK`           | `true` (default). Server derives a mask from composite+user diff if needed       |
| `REQUIRE_INTERNAL_MASK_FOR_ACCESSORIES` | `true` (default). Accessories without composite+mask never call OpenAI free-gen |
| `TRYON_ACCESSORY_STRICT_MODE` | `true` (default). Master switch for the strict accessory pipeline               |
| `TRYON_FALLBACK_TO_DETERMINISTIC` | `true` (default). Return the deterministic composite when fidelity checks fail |
| `DISABLE_FREE_GENERATION_FOR_ACCESSORIES` | `true` (default). No userImage+productImage-only OpenAI call for accessories |
| `REQUIRE_CLIENT_MASK`        | `false` (default). The client never provides a mask                              |
| `OPENAI_PRESERVATION_THRESHOLD` | 0..1 score threshold for outside-mask preservation (default `0.92`)            |
| `OPENAI_PRODUCT_LOCK`        | `true` (default). Re-stamp the original product PNG after the AI edit (accessories) |
| `OPENAI_PRESERVE_CUSTOMER_STRICT` | `true` (default). Reject edits that change too much outside the mask (API-only) |
| `WATCH_USE_MASKED_EDIT`      | Per-category mask flag (defaults to `true`)                                      |
| `GLASSES_USE_MASKED_EDIT`    | Per-category mask flag (defaults to `true`)                                      |
| `HEADWEAR_USE_MASKED_EDIT`   | Per-category mask flag (defaults to `true`)                                      |
| `HAND_JEWELRY_USE_MASKED_EDIT` | Per-category mask flag (defaults to `true`)                                    |
| `CLOTHES_USE_MASKED_EDIT`    | Per-category mask flag (defaults to `true`)                                      |
| `FAL_KEY`                    | fal.ai API key — required for `AI_TRYON_PROVIDER=fal`                            |
| `FASHN_API_KEY`              | Optional, reserved for a future direct FASHN integration                         |
| `AI_TRYON_API_KEY`           | Legacy generic fallback (also accepted as `FAL_KEY`)                             |
| `NEXT_PUBLIC_AI_PROVIDER`    | Mirrors the provider name on the client (used by the privacy note + UI badges)   |

### API-only mode

Set any of `AI_TRYON_PROVIDER=openai`, `TRYON_RENDER_MODE=api-only`, or
`DISABLE_LOCAL_RENDER=true` to enter strict mode:

- The fast-overlay deterministic path is **never** returned as the final
  image — even if a client-side preview was uploaded.
- If OpenAI fails, `/api/try-on` responds with `{ ok: false, error: "OpenAI image edit failed. No local renderer fallback was used because API-only mode is enabled.", … }` and HTTP 502.
- `debug.usedLocalRenderer` is always `false` in success responses (except
  when a deterministic composite is returned as a fidelity fallback).
- **The customer never uploads or sees a mask.** Masks are generated
  automatically by the browser pipeline (MediaPipe + canvas) and, if
  needed, by the server (`lib/tryon/autoMaskFromComposite.ts`).

### Provider modes

- **`mock`** (default): no API key required. Returns a deterministic local
  image (`/demo2-result.png` for watches, otherwise category-specific
  Picsum.photos seeds). Useful to demo the widget without any cost.
- **`openai`**: routes to **OpenAI GPT Image** (`gpt-image-1` by default).
  For **accessories**, the first API call is always a **controlled masked
  edit**: the client sends `compositeImage` (user photo + product placed
  deterministically) + `maskImage` (auto-generated contact band). OpenAI
  only refines shadows/contact inside the mask; the product PNG is then
  re-stamped (`OPENAI_PRODUCT_LOCK`). The customer never provides a mask.
  Returns base64 → served as a `data:` URL.
- **`fal`**: routes to **fal.ai**.
  - **Clothes** → FASHN (`fashn/tryon/v1.6`, fallback `fal-ai/fashn/tryon`).
    If the FASHN call fails for any reason, the service automatically falls
    back to FLUX Kontext so the user always gets a result.
  - **Watch with composite + mask** → FLUX LoRA Inpainting
    (`fal-ai/flux-lora/inpainting`, with `flux-pro/v1/fill` and
    `sdxl-inpainting` as fallbacks).
  - **Headwear / glasses / hand-jewelry** → FLUX Kontext multi-image edit
    (`fal-ai/flux-pro/kontext/max/multi`) with category-specific prompts
    (see `lib/providers/prompts.ts`).
- **`auto`**: uses `openai` if `OPENAI_API_KEY` is present, otherwise `fal`
  if `FAL_KEY` is present, otherwise `mock`. Recommended for CI / preview
  deployments.

> **Strict provider mode:** when `AI_TRYON_PROVIDER=openai` or `=fal`, the
> API will **never** silently fall back to mock. If the matching key is
> missing, `/api/try-on` returns a `500` with an explicit error and
> `/api/ai-status` reports `mode: "openai-configured-but-missing-key"` (or
> `fal-configured-but-missing-key`).

---

## Render pipeline (overlay first vs AI first)

To get **commercially-viable accessory try-on**, the app now uses a
**controlled rendering pipeline** instead of relying on raw generative AI:

1. **MediaPipe Tasks Vision** detects landmarks in the browser:
   - `FaceLandmarker` (478 points) → glasses, headwear
   - `HandLandmarker` (21 points)   → watch, hand-jewelry (rings + bracelets)
2. **Deterministic placement math** (`lib/tryon/placement.ts`) computes a
   pixel-accurate transform — center, scale, rotation — for the product.
3. **Canvas compositing** (`lib/tryon/canvasRender.ts`) crops the product
   alpha-aware and draws it on top of the user photo with a soft shadow.
4. **Auto-mask generation** (`lib/tryon/watchMask.ts` for watches,
   `lib/tryon/canvasRender.ts` + `buildContactMask` for glasses / headwear /
   hand-jewelry) produces a feathered B/W contact-band mask aligned 1:1 with
   the composite. The customer never sees or uploads this mask.
5. On submit, the client sends `compositeImage` + `maskImage` (both PNG) to
   `/api/try-on` on the **first** premium call — not only on a separate
   "refine" step.
6. The server calls OpenAI masked edit with the strict integration prompt
   (`AUTO_MASKED_ACCESSORY_PROMPT` / `getWatchTryOnPrompt()`), re-stamps the
   original product (`product-lock`), and runs fidelity checks
   (outside-mask preservation + dominant product colour).

This eliminates the typical hallucinations of pure-AI try-on
(distorted hands, rings across two fingers, fake fingers, silver watch
replacing a black multicolour reference, etc.).

### Premium accessory pipeline (OpenAI)

```
customer photo + product image
  → MediaPipe landmarks
  → deterministic placement
  → composite PNG (product on body)
  → auto mask PNG (contact band, feathered)
  → normalizeEditInputsForOpenAI()   (dimension + coverage gate)
  → OpenAI masked edit               (input_fidelity=high, output_format=png)
  → product-lock re-stamp
  → fidelity + duplication check     (colour, silhouette ratio)
  → final result
```

If auto-mask fails in strict mode, the route returns the deterministic
composite with `warnings: [{ code: "auto_mask_failed_fallback_used", … }]`
instead of calling OpenAI in a free-generation mode.

### Why prompt alone is not enough

We tried "send userImage + productImage + a strict prompt" first. It
fails for accessories in three predictable ways:

1. **Product redesign.** Even with `"Do not change the product"` in the
   prompt, GPT Image will re-draw the watch from scratch. A black
   chronograph with rainbow accents becomes a silver-and-blue watch.
2. **Anatomy drift.** Without a mask, the model regenerates the entire
   hand. Fingers get longer, the wrist gets thinner, the thumb pose
   shifts.
3. **Product duplication.** The model sometimes draws a second watch on
   the other wrist or on the forearm because the reference image had
   the product floating on a transparent background.

The fix is structural, not textual:

- **Composite first.** The first image sent to OpenAI is the
  deterministic composite (user photo + product placed at the right
  spot). The prompt then says "improve the integration of this
  already-placed product".
- **Tight mask.** A small contact-band mask (≤ 18 % of the image for
  watches) restricts the model to the wrist/contact zone. The fingers
  and the back of the hand are alpha-opaque → preserved exactly.
- **Input fidelity high.** `input_fidelity=high` tells gpt-image-1 to
  stick close to the input pixels.
- **Product re-stamp.** The original transparent product PNG is
  re-applied on top of the AI result so dial / bezel / colour cannot
  drift.
- **Fidelity + duplication gates.** A connected-components flood-fill
  on the AI silhouette counts how many *separate* product regions the
  model drew. ≥ 2 components ⇒ duplication ⇒ fall back to the
  deterministic composite. Colour and area drift are checked
  independently with per-category thresholds (watches are the
  strictest: ΔRGB ≤ 38, area drift ≤ 30 %).

The mask is **never** visible to the customer. It is an internal
technical artefact. There is no mask uploader in the UI.

### Watch try-on — quality gates

The watch category has the tightest gates because the product silhouette
is small, sharp, and highly identity-sensitive (dial, bezel, colour
accents). The route exposes every gate result in `debug.gates`:

| Gate                          | Meaning                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `duplicateWatchDetected`      | `true` when ≥ 2 product-sized components were found in the AI output.      |
| `watchFidelityValid`          | `false` when the dominant colour drifted (ΔRGB > 38).                      |
| `watchScaleValid`             | `false` when the silhouette area drifted > 30 % from the composite.        |
| `customerPreservationValid`   | `false` when the AI changed > 12 % of the image outside the mask.          |
| `maskArtifactFree`            | `false` when the outside-mask change score is between 8 % and 12 %.        |

If any of these is `false`, the route either:

- returns the deterministic composite as the final result (when
  `TRYON_FALLBACK_TO_DETERMINISTIC=true`, the default), or
- emits a 502 with `failureReasons` populated (strict mode).

Watch-specific structural rules enforced by the pipeline:

- **One watch only.** `detectDuplicateProductPlacement` flood-fills the
  AI silhouette and refuses to ship results with more than one
  product-sized component.
- **Target wrist band.** `validateWatchPlacement` clamps the watch
  centre into the band that sits 0.2–0.55 × palmWidth from the wrist
  landmark toward the elbow, with a ±0.25 × palmWidth lateral margin.
  Anything outside this band is auto-re-anchored.
- **Size guard.** The watch span is clamped to 0.75–1.25 × wristWidth
  (≈ 0.64–1.06 × palmWidth). Hard cap at 1.06 × palmWidth even when
  user-driven scaling pushes higher.
- **Forearm-axis rotation.** `computeWristGeometry` uses the
  perpendicular of the forearm direction so the bracelet wraps with
  the wrist orientation instead of staying horizontal.
- **Product re-stamp.** When the product-lock pipeline is active, the
  original transparent watch PNG is re-applied on top of the AI
  result so identity cannot drift.

Tests live in `lib/tryon/__tests__/` and cover placement validation,
duplicate detection, and the per-category fidelity thresholds. Run
them with:

```bash
npm test
```

### Modes

| Mode      | Behavior                                                            |
| --------- | ------------------------------------------------------------------- |
| `auto`    | Accessories → fast overlay. Clothes → specialized VTON (FASHN).    |
| `fast`    | All accessories use the deterministic overlay only.                |
| `premium` | All accessories go through `fal-ai/flux-pro/kontext/max/multi`.    |

Premium is more expensive and prone to anatomical artifacts. We recommend
`auto` for production.

### Hand jewelry options

When `category=hand-jewelry`, the UI exposes:
- A **type** selector: `Ring` or `Bracelet`
- A **finger** selector for rings: `Index | Middle | Ring | Pinky` (default
  `Ring`)

These are passed to both the pipeline (`computeRingPlacement`) and the API
(`handJewelryType`, `ringFinger` form fields).

### Recommendations to merchants

The UI surfaces a banner for jewelry / watches / glasses:
**"Pour les bijoux, montres et lunettes, une photo nette et un produit sur
fond transparent (PNG) donnent un meilleur rendu."**

Transparent PNG product images are detected automatically and the result
quality is significantly higher when supplied.

### Product transparency end-to-end

The app preserves the product's alpha channel from upload to render:

- `ProductInput` runs an alpha probe (`getImageAlphaStats`) on every product
  image. Transparent PNGs are shown on a **checkerboard background** with a
  `PNG transparent` badge. Opaque uploads are flagged with a warning.
- For accessory categories (watch, glasses, headwear, hand-jewelry):
  - If the upload already has alpha → **skip** the cutout step.
  - If it has a background → call `POST /api/product/cutout`
    (`fal-ai/bria/background/remove`, fallback `fal-ai/imageutils/rembg`)
    and use the resulting transparent PNG.
- The deterministic overlay (`renderOverlay`) draws the user photo as a
  background layer, then the product **without** any rectangle. The canvas
  is exported as **PNG** to avoid JPEG re-compression on product edges.
- The `previewImage` sent to `/api/try-on` is a `.png` File with type
  `image/png`. Fal storage uploads preserve this MIME type.
- `/api/try-on` echoes `productHasAlpha`, `productMimeType`, and
  `productImageSource` (`transparent-upload | cutout | original`) in the
  `debug` field of the response.

#### Test: transparent product watch

1. Upload a transparent PNG of a watch.
2. Confirm the product list shows it on a **checkerboard** with the badge
   `PNG transparent détecté`.
3. The "Détourer le produit" button is **not** shown (skipped because
   alpha is present).
4. Generate a try-on (watch category).
5. Hit `/api/try-on` and inspect the response:
   ```json
   "debug": {
     "productHasAlpha": true,
     "productMimeType": "image/png",
     "productImageSource": "transparent-upload"
   }
   ```
6. The rendered result must not contain any rectangular product background.
7. If you open the preview blob URL in a new tab, it must be a `.png` file
   (visible in DevTools Network → "Type: png").
8. Repeat with an opaque JPG: badge becomes `Détouré` (after Bria runs),
   `productImageSource: "cutout"`, `productHasAlpha: true`.

---

## Activer la génération IA réelle avec fal.ai

By default the project runs in **mock** mode (no API key, deterministic
placeholder image). Follow these steps to enable real AI generation:

### Local

1. Create a fal.ai API key on [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys).
2. Add credits to your fal.ai account (FLUX Kontext and FASHN are paid models).
3. Create a `.env.local` file at the project root (this file is git-ignored):

   ```env
   AI_TRYON_PROVIDER=fal
   FAL_KEY=your_fal_key_here
   NEXT_PUBLIC_AI_PROVIDER=fal
   ```

4. Restart the dev server:

   ```bash
   npm run dev
   ```

5. Verify the configuration is picked up:

   ```bash
   curl http://localhost:3000/api/ai-status
   ```

   Expected JSON:

   ```json
   {
     "ok": true,
     "provider": "fal",
     "publicProvider": "fal",
     "hasFalKey": true,
     "mode": "real-ai"
   }
   ```

6. Run a try-on through the UI (`/embed` or `/`). The API response from
   `/api/try-on` should now include:

   ```json
   {
     "mock": false,
     "provider": "fal",
     "model": "fal-ai/flux-pro/kontext/max/multi",
     "category": "watch",
     "resultUrl": "https://fal.media/files/...",
     "generatedAt": 1234567890,
     "durationMs": 8732
   }
   ```

   The ResultView badge will read **"Généré avec IA · FLUX Kontext"** with a
   small **"Provider: fal.ai"** line underneath.

### Vercel (production)

1. Open the Vercel project → **Settings** → **Environment Variables**.
2. Add (for `Production`, optionally also `Preview` and `Development`):

   | Variable                  | Value                  |
   | ------------------------- | ---------------------- |
   | `AI_TRYON_PROVIDER`       | `fal`                  |
   | `FAL_KEY`                 | `<your fal.ai key>`    |
   | `NEXT_PUBLIC_AI_PROVIDER` | `fal`                  |

3. **Redeploy** the project (environment variable changes do not apply to
   already-running deployments).
4. Verify in production:

   ```bash
   curl https://your-domain.com/api/ai-status
   ```

### Security notes

- `FAL_KEY` is read **server-side only** (`process.env.FAL_KEY`). It is
  never sent to the browser.
- Never prefix the fal key with `NEXT_PUBLIC_*`.
- Never commit `.env.local` — `.gitignore` already excludes `.env*.local`.
- Errors returned by `/api/try-on` are sanitized to redact any occurrence
  of the key value before being sent to the client.

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
├── PhotoInstructionSingle.tsx  # Single-instruction photo guide (no media)
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
└── tryOnReducer.ts             # useReducer state for the wizard

public/
├── embed.js                    # Shopify widget loader (vanilla JS)
├── concept-trywithai.png       # Hero concept illustration (3 panels)
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

## Photo guide

Step 1 of the wizard shows `PhotoInstructionSingle`: one icon, the body
target (e.g. *Poignet ou main*) and a single action-oriented sentence
defined per category in `lib/categories.ts > photoSingleInstruction`.

The legacy multi-step animated guide (`PhotoGuideSteps` + procedural SVGs
+ optional custom media under `public/guide/`) has been removed on
purpose — one clear directive converts better than four illustrated
steps.

---

## Auto-mask pipeline — manual QA checklist

1. Submit **only** `userImage` + `productImage` (no `maskImage` field) for `watch`.
2. Confirm the browser pipeline produces `compositeImage` + `maskImage` in the FormData (Network tab).
3. Confirm there is **no** mask upload UI in `TryOnPanel` / `EmbedFlow`.
4. With `DISABLE_FREE_GENERATION_FOR_ACCESSORIES=true` and no internal mask → response is the deterministic composite, not a free OpenAI generation (`debug.fallbackUsed=true`, warning `auto_mask_failed_fallback_used`).
5. `compositeImage` and `maskImage` are `image/png` (not JPEG).
6. `compositeImage` and `maskImage` share the same pixel dimensions after client resize.
7. Product PNG alpha is preserved when the upload already had transparency.
8. A black multicolour watch reference must not become a silver invented watch (`debug.qualityCheckFailed` or deterministic fallback).
9. Hand anatomy outside the mask must stay preserved (`qualityChecks.outsideMaskPreserved`).
10. Accessory success with product-lock engaged must show `debug.productLockApplied=true` and `productLocked=true`.

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
