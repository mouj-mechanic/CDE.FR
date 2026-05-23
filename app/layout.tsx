import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CabinesDEssayage.fr — Votre cabine d'essayage virtuelle",
  description:
    "Essayez avant d'acheter, instantanément. Importez votre photo, ajoutez un article, laissez l'IA vous montrer le résultat.",
  keywords: [
    "essayage virtuel",
    "try-on",
    "mode",
    "IA",
    "cabine d'essayage",
  ],
  openGraph: {
    title: "CabinesDEssayage.fr",
    description: "Essayez avant d'acheter, instantanément.",
    type: "website",
    locale: "fr_FR",
    images: ["/og-image.svg"],
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${cormorant.variable} ${inter.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
