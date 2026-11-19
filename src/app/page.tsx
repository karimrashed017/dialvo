import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { CONTACT_EMAIL, PLANS, SITE_NAME, SITE_URL } from "@/lib/site";
import { BuyStrip, StickyBuy } from "./_site/buy";
import { FaqSection } from "./_site/faq";
import { FAQS } from "./_site/faqs";
import { SiteFooter } from "./_site/footer";
import { FreeTrialSection } from "./_site/free-trial";
import { Hero } from "./_site/hero";
import { ListenSection } from "./_site/listen";
import { SiteNav } from "./_site/nav";
import { PricingSection } from "./_site/pricing";
import {
  Asks,
  Compliance,
  Everything,
  FinalCall,
  HowItWorks,
  Logos,
  Numbers,
  Product,
} from "./_site/sections";
import { SpeedToLeadSection } from "./_site/speed-to-lead";
import { SiteFrame, siteViewport } from "./_site/theme";

export const viewport = siteViewport;

const DESCRIPTION =
  "Dialvo is an AI sales team for agencies, founders and small businesses. It calls prospects and warm leads, follows up by text, WhatsApp and email, and books meetings.";

export const metadata: Metadata = pageMetadata({
  title:
    "Dialvo · Your AI sales team that calls, follows up and books meetings",
  description: DESCRIPTION,
  path: "/",
});

// What search engines and AI assistants read about Dialvo.
const STRUCTURED = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/brand/app-icon.svg`,
    email: CONTACT_EMAIL,
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: DESCRIPTION,
    offers: [PLANS.starter, PLANS.pro].map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: String(p.price),
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: String(p.price),
        priceCurrency: "USD",
        unitText: "MONTH",
      },
    })),
  },
];

export default function Home() {
  return (
    <SiteFrame>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(STRUCTURED) }}
      />
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <Logos />
        <Product />
        <ListenSection />
        <BuyStrip line="Every call is recorded and transcribed, on every plan." />
        <FreeTrialSection />
        <HowItWorks />
        <SpeedToLeadSection />
        <Everything />
        <Numbers />
        <Compliance />
        <Asks />
        <PricingSection />
        <FaqSection groups={FAQS} />
        <FinalCall />
      </main>
      <SiteFooter />
      <StickyBuy />
    </SiteFrame>
  );
}
