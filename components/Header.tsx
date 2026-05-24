import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/50 bg-white/60 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-1 px-4 py-5 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
        <div className="text-center sm:text-left">
          <Link
            href="/"
            className="font-display text-xl font-bold tracking-tight sm:text-2xl"
          >
            <span className="text-gradient">CabinesDEssayage</span>
            <span className="text-bordeaux">.fr</span>
          </Link>
          <p className="mt-0.5 text-sm text-ink-muted">
            Essayez avant d&apos;acheter, instantanément.
          </p>
        </div>
      </div>
    </header>
  );
}
