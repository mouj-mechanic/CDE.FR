import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { CategoryGrid } from "@/components/CategoryGrid";
import { Footer } from "@/components/Footer";

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <section id="cabines" className="scroll-mt-24 px-4 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">
                <span className="text-ink">Choisissez votre </span>
                <span className="text-gradient">cabine</span>
              </h2>
              <p className="mt-3 text-ink-muted">
                Sélectionnez une catégorie pour commencer votre essayage virtuel
              </p>
            </div>
            <CategoryGrid />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
