import Script from "next/script";
import type { Metadata } from "next";

const productImage =
  "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=800&q=80";

export const metadata: Metadata = {
  title: "Démo PDP — CabinesDEssayage",
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    images: [productImage],
  },
};

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="text-xl font-bold text-gray-900">DEMO SHOP</span>
          <nav className="hidden gap-6 text-sm text-gray-600 sm:flex">
            <span>Boutique</span>
            <span>Collections</span>
            <span>À propos</span>
            <span>Panier (0)</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <p className="mb-6 text-xs uppercase tracking-wider text-gray-500">
          Accueil / Couvre-chefs / Casquette en laine bordeaux
        </p>

        <div className="grid gap-12 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={productImage}
              alt="Casquette en laine bordeaux"
              className="h-full w-full object-cover"
            />
          </div>

          <div>
            <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
              Casquette en laine bordeaux
            </h1>
            <p className="mt-3 text-2xl font-semibold text-gray-900">79,00 €</p>
            <p className="mt-2 text-sm text-gray-500">
              TTC — Livraison gratuite dès 80 €
            </p>

            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-gray-700">Taille</p>
              <div className="flex gap-2">
                {["S", "M", "L", "XL"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="h-10 w-10 rounded border border-gray-300 text-sm hover:border-gray-900"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="mt-8 w-full rounded-md bg-gray-900 py-4 font-medium text-white hover:bg-gray-800"
            >
              Ajouter au panier
            </button>

            <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <strong>Démo MVP :</strong> patientez 2,5 s — la bulle
              &quot;Essayer virtuellement&quot; apparaît en bas à droite.
            </div>
          </div>
        </div>
      </main>

      {/* Pas de data-app-url : embed.js utilise window.location.origin (localhost) */}
      <Script
        id="cabines-embed"
        src="/embed.js"
        data-delay="2500"
        data-label="Essayer virtuellement"
        data-pages="all"
        strategy="afterInteractive"
      />
    </div>
  );
}
