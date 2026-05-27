import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
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
