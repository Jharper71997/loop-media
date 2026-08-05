import type { Metadata } from "next";
import { ScrollDepth } from "@/components/analytics/ScrollDepth";
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'

export const metadata: Metadata = {
  title: "Privacy Policy | Loop Network",
  description: "How Loop Network collects, uses, and protects your information.",
};

// Standard privacy policy for the Loop Network advertising platform.
// Required by Google Play (a hosted privacy policy URL is mandatory for app listings).
// Jacob: confirm the contact email + legal entity line before publishing; have a
// professional review it if you want it airtight.
const EFFECTIVE_DATE = "June 29, 2026";
const CONTACT_EMAIL = "privacy@loopnetwork.org"; // TODO: confirm this mailbox exists
const ENTITY = "Loop Network LLC";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-heading text-xl font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <ScrollDepth page="privacy" />
      <h1 className="font-heading text-3xl font-bold text-foreground">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>

      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        This Privacy Policy explains how {ENTITY} (&quot;Loop Network,&quot; &quot;we,&quot;
        &quot;us&quot;) collects, uses, and protects information when you use the Loop
        Network platform, including our website, advertiser and host dashboards, and the
        on-screen experiences shown in partner venues.
      </p>

      <Section title="Information we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-foreground">Account information.</span> When advertisers
            or venue hosts create an account, we collect a name, email address, business
            name, and related contact details.
          </li>
          <li>
            <span className="text-foreground">Payment information.</span> Subscription and
            advertising payments are processed by Stripe. We do not store full card
            numbers; Stripe handles card data under its own security and compliance.
          </li>
          <li>
            <span className="text-foreground">Usage information.</span> We collect basic
            usage and device data (such as pages viewed, approximate location of host
            screens, and log data) to operate and improve the service.
          </li>
          <li>
            <span className="text-foreground">Trivia and on-screen play.</span> If you join
            an on-screen game from your phone, we collect the nickname you choose and your
            answers. This does not require an account and is not used to identify you.
          </li>
        </ul>
      </Section>

      <Section title="How we use information">
        <ul className="list-disc space-y-2 pl-5">
          <li>To provide, operate, and maintain the Loop Network platform.</li>
          <li>To process payments and manage advertiser and host subscriptions.</li>
          <li>To schedule, display, and report on advertising shown on venue screens.</li>
          <li>To communicate with you about your account, billing, and support.</li>
          <li>To protect the service against fraud, abuse, and security threats.</li>
        </ul>
      </Section>

      <Section title="How information is shared">
        <p>
          We do not sell your personal information. We share information only with service
          providers that help us run the platform, and only as needed:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-foreground">Stripe</span> for payment processing.
          </li>
          <li>
            <span className="text-foreground">Supabase</span> for database, authentication,
            and storage.
          </li>
          <li>
            <span className="text-foreground">Vercel</span> for application hosting.
          </li>
          <li>
            When required by law, or to protect the rights, safety, and property of Loop
            Network, our users, or the public.
          </li>
        </ul>
      </Section>

      <Section title="Advertising on venue screens">
        <p>
          Advertisements are displayed on televisions located in partner venues. We do not
          use cameras, facial recognition, or any technology that identifies or tracks
          individual people through those screens. On-screen ad performance is measured at
          the screen and venue level, not the individual level.
        </p>
      </Section>

      <Section title="Cookies and local storage">
        <p>
          We use cookies and similar local storage to keep you signed in, remember
          preferences, and understand how the service is used. You can control cookies
          through your browser settings, though some features may not work without them.
        </p>
      </Section>

      <Section title="Data retention">
        <p>
          We keep personal information for as long as your account is active or as needed to
          provide the service, comply with legal obligations, resolve disputes, and enforce
          our agreements. You can request deletion of your account information by contacting
          us.
        </p>
      </Section>

      <Section title="Your choices and rights">
        <p>
          You may request access to, correction of, or deletion of your personal
          information by contacting us at the address below. Depending on where you live,
          you may have additional rights under applicable privacy laws.
        </p>
      </Section>

      <Section title="Children's privacy">
        <p>
          Loop Network is intended for businesses and adults. It is not directed to children
          under 13, and we do not knowingly collect personal information from children.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. When we do, we will revise the
          effective date above and, where appropriate, provide additional notice.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          If you have questions about this Privacy Policy or your information, contact us at{" "}
          <a className="text-foreground underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
      </main>
      <SiteFooter />
    </>
  );
}
