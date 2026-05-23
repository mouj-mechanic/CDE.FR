import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/40 bg-cream/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-1 px-4 py-5 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
        <div className="text-center sm:text-left">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-bordeaux sm:text-2xl"
          >
            CabinesDEssayage.fr
          </Link>
          <p className="mt-0.5 text-sm text-ink-muted">
            Essayez avant d&apos;acheter, instantanément.
          </p>
        </div>
      </div>
    </header>
  );
}
