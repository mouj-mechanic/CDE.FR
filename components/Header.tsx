import Link from "next/link";
import { brand } from "@/lib/brand";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/50 bg-white/60 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-bordeaux to-gold text-sm font-bold text-white shadow-soft"
          >
            T
          </span>
          <span className="font-display text-lg font-bold tracking-tight sm:text-xl">
            <span className="text-gradient">{brand.name}</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-ink-muted sm:flex">
          <a href="#how-it-works" className="transition hover:text-bordeaux">
            Fonctionnement
          </a>
          <a href="#shopify" className="transition hover:text-bordeaux">
            Shopify
          </a>
          <a href="#pricing" className="transition hover:text-bordeaux">
            Tarifs
          </a>
          <a
            href="#contact"
            className="rounded-xl bg-gradient-to-r from-bordeaux to-gold px-4 py-2 font-medium text-white shadow-soft transition hover:shadow-lifted"
          >
            Réserver une démo
          </a>
        </nav>
      </div>
    </header>
  );
}
