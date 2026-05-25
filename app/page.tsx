import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { CategoryGrid } from "@/components/CategoryGrid";
import { Footer } from "@/components/Footer";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { ShopifyIntegration } from "@/components/sections/ShopifyIntegration";
import { Pricing } from "@/components/sections/Pricing";
import { PrivacySection } from "@/components/sections/PrivacySection";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { DemoSection } from "@/components/sections/DemoSection";

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <DemoSection />
        <section id="cabines" className="scroll-mt-24 px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-bordeaux">
                Essayez le widget
              </p>
              <h2 className="font-display text-3xl font-bold sm:text-4xl">
                <span className="text-ink">Choisissez une </span>
                <span className="text-gradient">catégorie</span>
              </h2>
              <p className="mt-3 text-ink-muted">
                Testez la cabine d&apos;essayage directement, sans intégrer le
                widget sur une boutique.
              </p>
            </div>
            <CategoryGrid />
          </div>
        </section>
        <HowItWorks />
        <ShopifyIntegration />
        <Pricing />
        <PrivacySection />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
