export function Footer() {
  return (
    <footer className="border-t border-ink/5 bg-white/40 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center text-sm text-ink-muted sm:flex-row sm:text-left">
        <p>
          © {new Date().getFullYear()} CabinesDEssayage.fr — Tous droits
          réservés.
        </p>
        <p className="text-xs">
          MVP — Essayage virtuel par intelligence artificielle
        </p>
      </div>
    </footer>
  );
}
