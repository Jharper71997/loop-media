import type { Metadata } from "next";
import {
  AGREEMENT_INTRO,
  AGREEMENT_SECTIONS,
  AGREEMENT_VERSION,
} from "@/lib/agreement";
import { ScrollDepth } from "@/components/analytics/ScrollDepth";
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of the Loop Network platform.",
};

// Standard terms of service for the Loop Network advertising platform.
// Jacob: confirm the contact email + legal entity line before relying on this;
// have a professional review it if you want it airtight.
const EFFECTIVE_DATE = "June 30, 2026";
const CONTACT_EMAIL = "privacy@loopnetwork.org"; // TODO: confirm the real contact mailbox
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

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <ScrollDepth page="terms" />
      <h1 className="font-heading text-3xl font-bold text-foreground">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>

      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the Loop
        Network platform operated by {ENTITY} (&quot;Loop Network,&quot; &quot;we,&quot;
        &quot;us&quot;), including our website, advertiser and host dashboards, and the
        on-screen experiences shown in partner venues. By creating an account or using the
        service, you agree to these Terms.
      </p>

      <Section title="The service">
        <p>
          Loop Network is an indoor advertising platform. Advertisers buy recurring placements
          that display on televisions located in partner venues. Venue hosts display those
          screens and may run their own promotional content where eligible. We may add, change,
          or remove features at any time.
        </p>
      </Section>

      <Section title="Accounts">
        <p>
          You must provide accurate information and keep your login secure. You are responsible
          for activity under your account. You must be at least 18 and authorized to act for the
          business you represent.
        </p>
      </Section>

      <Section title="Advertiser terms">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Advertising placements are sold on a recurring monthly basis at the prices shown at
            checkout. Available inventory, venue mix, and screen counts may change over time.
          </li>
          <li>
            You are responsible for the content of your ads and confirm you have the rights to
            everything you upload. Ads are subject to review and approval before they run.
          </li>
          <li>
            We do not guarantee a specific number of impressions, scans, or business results.
            Reported metrics are good-faith estimates measured at the screen and venue level.
          </li>
        </ul>
      </Section>

      <Section title="Host terms">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Hosting is offered free of charge to approved venues. You agree to keep the screen
            powered on and visible during your normal open hours.
          </li>
          <li>
            Eligible hosts may run free promotional slots on other Loop Network screens, subject
            to availability and our content rules. We may remove a venue from the network at our
            discretion.
          </li>
        </ul>
      </Section>

      <Section title="Billing and cancellation">
        <p>
          Subscriptions are billed in advance each month through Stripe and renew automatically
          until canceled. You can cancel anytime from your dashboard; cancellation stops future
          renewals and your placements end at the close of the current billing period. Except
          where required by law, payments already made are non-refundable.
        </p>
      </Section>

      <Section title="Content and acceptable use">
        <p>
          You may not submit content that is illegal, deceptive, infringing, hateful, or
          otherwise inappropriate for a general-audience venue, and you may not misuse the
          platform, interfere with its operation, or attempt to access it without authorization.
          We may reject or remove content and suspend accounts that violate these Terms.
        </p>
      </Section>

      <Section title="Intellectual property">
        <p>
          Loop Network and its platform, including its software, branding, and design, are owned
          by us. You keep ownership of the ad content you provide and grant us a license to host,
          display, and distribute it across the network solely to provide the service.
        </p>
      </Section>

      <Section title="Disclaimers and limitation of liability">
        <p>
          The service is provided &quot;as is&quot; without warranties of any kind. To the fullest
          extent permitted by law, Loop Network is not liable for indirect, incidental, or
          consequential damages, and our total liability for any claim is limited to the amount
          you paid us in the three months before the claim arose.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We may update these Terms from time to time. When we do, we will revise the effective
          date above and, where appropriate, provide additional notice. Continued use of the
          service means you accept the updated Terms.
        </p>
      </Section>

      <Section title="Advertising Service Agreement">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Version {AGREEMENT_VERSION} — signed by hosts at venue registration.
        </p>
        <p>{AGREEMENT_INTRO}</p>
        {AGREEMENT_SECTIONS.map((s) => (
          <div key={s.n} className="space-y-1">
            <p className="font-medium text-foreground">
              {s.n}. {s.title}
            </p>
            {s.body.split("\n\n").map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        ))}
      </Section>

      <Section title="Contact us">
        <p>
          Questions about these Terms? Contact us at{" "}
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
