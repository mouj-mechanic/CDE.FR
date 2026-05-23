import Script from "next/script";
import type { Metadata } from "next";
import { headers } from "next/headers";

const PRODUCT_IMAGE_PATH = "/demo-watch-gold-green.svg";
const productTitle = "Montre automatique « Émeraude » or & vert";

async function getBaseUrl(): Promise<string> {
  const hdrs = await headers();
  const host =
    hdrs.get("x-forwarded-host") || hdrs.get("host") || "localhost:3000";
  const proto =
    hdrs.get("x-forwarded-proto") ||
    (host.includes("localhost") || host.startsWith("192.168.")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const base = await getBaseUrl();
  const imageUrl = `${base}${PRODUCT_IMAGE_PATH}`;
  return {
    metadataBase: new URL(base),
    title: "Démo PDP — Montre or & vert | CabinesDEssayage",
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      title: productTitle,
      images: [{ url: imageUrl, width: 800, height: 1000, alt: productTitle }],
    },
  };
}

export default async function Demo2Page() {
  const base = await getBaseUrl();
  const productImageAbsolute = `${base}${PRODUCT_IMAGE_PATH}`;

  return (
    <div className="min-h-screen bg-[#0E1A14] text-[#E9EDE6]">
      <header className="border-b border-[#1F2D24]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="text-xl font-bold tracking-wider text-[#D4AF37]">
            ATELIER VERT&nbsp;OR
          </span>
          <nav className="hidden gap-6 text-sm text-[#A8B4A8] sm:flex">
            <span>Horlogerie</span>
            <span>Joaillerie</span>
            <span>Atelier</span>
            <span>Panier (0)</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <p className="mb-6 text-xs uppercase tracking-wider text-[#8FA38F]">
          Accueil / Horlogerie / Montre Émeraude or & vert
        </p>

        <div className="grid gap-12 lg:grid-cols-2">
          {/* Product image — explicit aspect-ratio so it never collapses to 0 height */}
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[#1A2E22] via-[#0F1F17] to-[#0A1410] shadow-[0_30px_80px_rgba(0,0,0,0.5)] ring-1 ring-[#D4AF37]/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={PRODUCT_IMAGE_PATH}
              alt={productTitle}
              width={800}
              height={1000}
              data-product-featured-image
              className="absolute inset-0 h-full w-full object-contain p-4"
            />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
              Édition limitée — 250 pièces
            </p>
            <h1 className="mt-2 font-serif text-3xl font-bold text-[#F5F1E4] sm:text-4xl">
              {productTitle}
            </h1>
            <p className="mt-3 text-2xl font-semibold text-[#F5F1E4]">
              4 850,00 €
            </p>
            <p className="mt-2 text-sm text-[#8FA38F]">
              TTC — Livraison express offerte · Garantie 5 ans
            </p>

            <div className="mt-6 grid grid-cols-2 gap-4 text-sm text-[#C8D2C8]">
              <div className="rounded-lg border border-[#1F2D24] bg-[#0B1510] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[#8FA38F]">
                  Boîtier
                </p>
                <p className="font-medium">Or jaune 18 ct · 40 mm</p>
              </div>
              <div className="rounded-lg border border-[#1F2D24] bg-[#0B1510] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[#8FA38F]">
                  Cadran
                </p>
                <p className="font-medium">Vert émeraude soleillé</p>
              </div>
              <div className="rounded-lg border border-[#1F2D24] bg-[#0B1510] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[#8FA38F]">
                  Mouvement
                </p>
                <p className="font-medium">Automatique COSC</p>
              </div>
              <div className="rounded-lg border border-[#1F2D24] bg-[#0B1510] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[#8FA38F]">
                  Bracelet
                </p>
                <p className="font-medium">Cuir alligator vert</p>
              </div>
            </div>

            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-[#C8D2C8]">
                Taille bracelet
              </p>
              <div className="flex gap-2">
                {["S", "M", "L", "XL"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="h-10 w-10 rounded border border-[#2A3D30] bg-[#0B1510] text-sm text-[#E9EDE6] hover:border-[#D4AF37]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="mt-8 w-full rounded-md bg-gradient-to-r from-[#D4AF37] via-[#E8C861] to-[#B8941F] py-4 font-semibold tracking-wide text-[#0E1A14] shadow-lg hover:brightness-110"
            >
              Ajouter au panier
            </button>

            <div className="mt-8 rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-4 text-sm text-[#F5E9C2]">
              <strong>Démo MVP :</strong> patientez 2,5&nbsp;s — la bulle
              &quot;Essayer virtuellement&quot; apparaît en bas à droite. La
              cabine détectera automatiquement la catégorie{" "}
              <em>Montre / Bracelet</em>.
            </div>
          </div>
        </div>
      </main>

      <Script
        id="cabines-embed"
        src="/embed.js"
        data-delay="2500"
        data-label="Essayer virtuellement"
        data-pages="all"
        data-color="#1A4D33"
        data-product-image={productImageAbsolute}
        strategy="afterInteractive"
      />
    </div>
  );
}
