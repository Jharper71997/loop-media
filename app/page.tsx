import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'
import { BrandLockup } from '@/components/app/BrandLockup'
import { cn } from '@/lib/utils'

export default async function Home() {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex w-full max-w-md flex-col items-center">
        <BrandLockup className="h-40 w-auto" />

        <span className="mt-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Facebook ads, but physical
        </span>

        <h1 className="mt-6 text-balance font-heading text-4xl font-extrabold leading-[1.05] tracking-tight">
          Get seen <span className="text-gold-metallic">where people go.</span>
        </h1>
        <p className="mt-4 text-pretty text-base text-muted-foreground">
          We put your business on the TVs in the busiest bars, gyms, and shops in town, then show
          you exactly who&apos;s seeing it. You pick the spots, we handle the rest.
        </p>

        {/* Plain "how it works" steps — say clearly what we do and how we help,
            the way a sales-led competitor's site walks you through their process. */}
        <div className="mt-8 w-full text-left">
          <p className="mb-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
            How it works
          </p>
          <div className="grid gap-2.5">
            {[
              {
                step: '1',
                title: 'Pick your screens on a map',
                sub: 'Choose the local bars, gyms, and shops where your customers already go.',
              },
              {
                step: '2',
                title: "Add your ad, or we'll make it",
                sub: 'Upload a 15-second spot, or have our team design one for you.',
              },
              {
                step: '3',
                title: 'Go live and see results',
                sub: 'Your ad runs in minutes, and a QR on it tracks every scan so you know it works.',
              },
            ].map(({ step, title, sub }) => (
              <div
                key={step}
                className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-gold-metallic">
                  {step}
                </span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Plain reassurances — the questions a first-timer asks before signing up. */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {["Competitors can't share your screens", 'Month-to-month', "We'll design your ad"].map(
            (t) => (
              <span
                key={t}
                className="rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground"
              >
                {t}
              </span>
            )
          )}
        </div>

        <div className="mt-6 flex w-full flex-col items-center gap-3">
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: 'lg' }), 'h-12 w-full text-base')}
          >
            Start advertising
          </Link>
          <Link
            href="/login"
            className="mt-1 text-sm text-muted-foreground hover:text-foreground"
          >
            Log in
          </Link>
          {/* Hosting is a separate path, not a co-equal CTA — a quiet link for
              venue owners rather than a primary button. */}
          <Link
            href="/signup?role=host"
            className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Own a venue? Host a screen &rarr;
          </Link>
        </div>
      </div>
    </main>
  )
}
