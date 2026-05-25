import { brand } from "@/lib/brand";

export function Footer() {
  return (
    <footer className="border-t border-ink/5 bg-white/40 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-lg font-bold">
            <span className="text-gradient">{brand.name}</span>
          </p>
          <p className="text-sm text-ink-muted">{brand.positioningFr}</p>
        </div>
        <div className="flex flex-col gap-1 text-xs text-ink-muted sm:items-end">
          <p>
            © {new Date().getFullYear()} {brand.name} — MVP démo.
          </p>
          <p>
            Contact :{" "}
            <a
              href={`mailto:${brand.supportEmail}`}
              className="font-medium text-bordeaux hover:underline"
            >
              {brand.supportEmail}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
