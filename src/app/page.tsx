import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import {
  CONTACT_EMAIL,
  DESCRIPTION,
  PLANS,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";
import { BuyStrip, StickyBuy } from "./_site/buy";
import { Channels } from "./_site/channels";
import { FaqSection } from "./_site/faq";
import { FAQS } from "./_site/faqs";
import { SiteFooter } from "./_site/footer";
import { Hero } from "./_site/hero";
import { ControlSection } from "./_site/listen";
import { SiteNav } from "./_site/nav";
import { PricingSection } from "./_site/pricing";
import {
  Compliance,
  FinalCall,
  Motions,
  Platform,
  Plays,
  Tools,
} from "./_site/sections";
import { SiteFrame, siteViewport } from "./_site/theme";

export const viewport = siteViewport;

export const metadata: Metadata = pageMetadata({
  title: "Dialvo · AI sales agents for every channel",
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
    featureList: [
      "AI voice agents for inbound leads and existing customers",
      "AI email agents",
      "Website chat agents",
      "Social agents",
      "SMS and WhatsApp follow-up",
      "Human dialer for sales reps",
      "Lead qualification, routing and meeting scheduling",
      "CRM sync",
    ],
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
        <Tools />
        <Channels />
        <Motions />
        <Plays />
        <Platform />
        <ControlSection />
        <BuyStrip line="Every call recorded, every message visible, on every plan." />
        <Compliance />
        <PricingSection />
        <FaqSection groups={FAQS} />
        <FinalCall />
      </main>
      <SiteFooter />
      <StickyBuy />
    </SiteFrame>
  );
}
