import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "../globals.css";

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
  title: "Cabine d'essayage virtuelle",
  description: "Essayez avant d'acheter, instantanément.",
  robots: { index: false, follow: false },
};

export default function EmbedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Transparent body so the merchant page can show through when the
  // iframe is positioned as an overlay. The bubble itself paints its
  // own opaque background.
  return (
    <html lang="fr" className={`${cormorant.variable} ${inter.variable}`}>
      <body className="min-h-screen bg-transparent">{children}</body>
    </html>
  );
}
