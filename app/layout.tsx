import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import { ColorfulBackdrop } from "@/components/ColorfulBackdrop";
import { brand } from "@/lib/brand";

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
  metadataBase: new URL(brand.appDomain),
  title: `${brand.name} — ${brand.positioningFr}`,
  description: `${brand.tagline} ${brand.positioningFr}.`,
  keywords: [
    "TryWithAI",
    "essayage virtuel",
    "virtual try-on",
    "Shopify",
    "widget IA",
    "AI try-on",
    "e-commerce",
  ],
  openGraph: {
    title: brand.name,
    description: brand.taglineFr,
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
    <html lang={brand.defaultLocale} className={`${cormorant.variable} ${inter.variable}`}>
      <body className="relative min-h-screen overflow-x-hidden">
        <ColorfulBackdrop />
        {children}
      </body>
    </html>
  );
}
