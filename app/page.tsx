import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  MapPin,
  Ban,
  MonitorPlay,
  QrCode,
  Gift,
  Check,
  Wallet,
  EyeOff,
  HelpCircle,
  Tag,
  Zap,
  ArrowRight,
} from 'lucide-react'
import { getProfile, homeForRole } from '@/lib/auth'
import { getLiveAds } from '@/lib/liveAds'
import { createAdminClient } from '@/lib/supabase/admin'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatCents, ordinal } from '@/lib/format'
import { RATE_CARD, perLocationCents, type PricingConfig } from '@/lib/pricing'
import { getPricingConfig } from '@/lib/pricing.server'
import { ScrollDepth } from '@/components/analytics/ScrollDepth'
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'
import { LiveAdCard } from '@/components/site/LiveAdCard'
import { InstallGallery } from '@/components/site/InstallGallery'
import { TvFrame } from '@/components/site/TvFrame'
import { AdScreenPreview } from '@/components/app/AdScreenPreview'

// The hero and the "on the screens" strip show ads that are live at this moment,
// so the page can't be statically cached.
export const dynamic = 'force-dynamic'

// The published rate card, built from the LIVE pricing config (not a copy of it)
// so this page can never quote a number checkout doesn't honor — the old copy
// promised "no minimum" against a $200 minimum sitting in code. Cheapest rung
// last: the single location anchors, the top rung closes.
//
// Priced per LOCATION, not per TV — one price covers every screen in that
// business, so the card counts businesses.
//
// `freeRung` is the "buy 4, the 5th is free" pitch. It isn't a promo — it falls
// out of the ladder, because the top rung drops the rate by exactly enough that
// 4 and 5 locations bill the same. Recomputed rather than written down, so the
// claim removes itself if the card ever stops making it true.
function rateCard(config: PricingConfig) {
  const rows = [
    { label: '1 location', eachCents: config.tierPriceCents.local, count: 1, plus: false },
    ...[...RATE_CARD]
      .sort((a, b) => a.locations - b.locations)
      .map((r, i, arr) => ({
        label: `${r.locations}${i === arr.length - 1 ? '+' : ''} locations`,
        eachCents: perLocationCents(r.locations, config),
        count: r.locations,
        plus: i === arr.length - 1,
      })),
  ]
  const top = Math.max(...RATE_CARD.map((r) => r.locations))
  return {
    rows,
    lowestCents: rows[rows.length - 1].eachCents,
    freeRung:
      (top - 1) * perLocationCents(top - 1, config) === top * perLocationCents(top, config)
        ? top
        : null,
  }
}

// ---- StoryBrand content blocks ------------------------------------------------

// The Stakes: the problem, on three levels (external / internal / philosophical),
// with the villain named — "advertising you can't measure."
const PROBLEM = [
  {
    icon: Wallet,
    title: 'Money out the door',
    sub: 'Billboards, mailers, and boosted posts cost a fortune and vanish without a trace.',
  },
  {
    icon: EyeOff,
    title: 'No idea what worked',
    sub: 'You pay, you cross your fingers, and you never really know if a single customer came from it.',
  },
  {
    icon: HelpCircle,
    title: 'Stuck guessing',
    sub: "You're tired of betting your budget on hope. Every ad dollar should have to prove itself.",
  },
]

// Why an indoor screen works — qualitative, defensible truths about the medium.
// Deliberately NO measured-attention numbers (dwell time) or "Nx a billboard"
// multipliers: we don't track those, so we don't claim a figure we can't stand
// behind. Everything here is either true of the medium itself or a real feature.
const WHY = [
  {
    icon: MapPin,
    title: 'In the room',
    sub: 'On a screen where your customers already are, not a highway they drive past.',
  },
  {
    icon: Ban,
    title: 'Unskippable',
    sub: "It can't be scrolled past, skipped, or ad-blocked like an online ad.",
  },
  {
    icon: QrCode,
    title: 'Measurable',
    sub: 'A QR on every ad turns a glance into a scan you can actually count.',
  },
  {
    icon: MapPin,
    title: 'Local',
    sub: 'Real neighborhood screens where your customers already spend time.',
  },
]

// The Guide's authority: real, shipped reasons to trust Loop over the alternatives.
const GUIDE = [
  {
    icon: QrCode,
    title: 'Proof on every ad',
    sub: 'A QR code on every ad, plus proof of every play, so you see exactly where and when your ad ran.',
  },
  {
    icon: Tag,
    title: 'Published pricing',
    sub: 'You always see the price before you buy. No "request a media kit," no sales runaround.',
  },
  {
    icon: MonitorPlay,
    title: 'Live in days',
    sub: 'Upload your ad and it starts running on local screens within days, not weeks.',
  },
  {
    icon: Zap,
    title: 'Self-serve and flexible',
    sub: 'Pick screens and manage your ad yourself. Cancel anytime, with a monthly results report.',
  },
]

// The Plan: three obvious steps that remove confusion and risk.
const STEPS = [
  {
    n: '1',
    title: 'Pick your screens on a map',
    sub: 'Choose the exact local bars, gyms, and shops where your customers already go.',
  },
  {
    n: '2',
    title: "Add your ad, or we'll make it",
    sub: 'Upload a 15-second spot, or have our team design one for you.',
  },
  {
    n: '3',
    title: 'Go live and see results',
    sub: 'Your ad goes live once it clears a quick review, and you see exactly where and when it plays.',
  },
]

export default async function Home() {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  const admin = createAdminClient()
  const [liveAds, { data: venueRows }, pricingConfig] = await Promise.all([
    getLiveAds(),
    admin
      .from('venues')
      .select('id, name')
      .eq('status', 'active')
      .eq('is_demo', false)
      .order('name'),
    getPricingConfig(),
  ])
  const { rows: rateRows, lowestCents, freeRung } = rateCard(pricingConfig)
  const venues = venueRows ?? []
  const heroAd = liveAds[0] ?? null
  // Skip the hero's ad — showing it again three inches lower reads as a bug.
  const stripAds = liveAds.slice(1, 4)

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <ScrollDepth page="marketing_home" />

        {/* HEADER / HERO — grunt test: what you offer, how life improves, what to do.
            The customer (the local business owner) is the hero; Loop is the guide.
            The TV on the right is a REAL ad that is running today — the page's first
            piece of proof, and the reason it no longer opens on a wall of text. */}
        <section className="bg-wash-radial">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:py-20">
            <div className="text-center lg:text-left">
              <span className="inline-block rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                Indoor TV advertising you can actually measure
              </span>
              <h1 className="mt-5 text-balance font-heading text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
                Your business, on the screens your customers{' '}
                <span className="text-gold-metallic">already watch.</span>
              </h1>
              <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground lg:mx-0">
                Loop Network puts your ad on the TVs in the busiest local bars, gyms, and shops, and
                shows you exactly where and when it plays. Every ad carries its own QR code, with
                scan analytics coming soon.
              </p>
              <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Link
                  href="/signup"
                  className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}
                >
                  Start advertising
                </Link>
                <Link
                  href="/preview"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'lg' }),
                    'w-full sm:w-auto'
                  )}
                >
                  See your ad on a TV
                </Link>
              </div>
              <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground lg:justify-start">
                {[
                  `As low as ${formatCents(lowestCents)} / location / month`,
                  ...(freeRung
                    ? [`Buy ${freeRung - 1} locations, the ${ordinal(freeRung)} is free`]
                    : []),
                  'Month to month',
                  'Run a video or an image',
                  'We can design your ad',
                ].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check className="size-3.5 text-primary" /> {t}
                  </span>
                ))}
              </div>
            </div>

            {/* The proof, immediately: a real live ad on a real TV. */}
            <div className="mx-auto w-full max-w-md lg:max-w-none">
              <TvFrame>
                {heroAd ? (
                  <AdScreenPreview
                    creativeUrl={heroAd.creativeUrl}
                    creativeType={heroAd.creativeType}
                    qrUrl={heroAd.qrUrl}
                    className="rounded-none ring-0"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center text-xs text-white/40">
                    Loop Network
                  </div>
                )}
              </TvFrame>
              {heroAd && (
                <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-success" />
                  </span>
                  On {heroAd.venues} {heroAd.venues === 1 ? 'screen' : 'screens'} right now —{' '}
                  {heroAd.title}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ON THE SCREENS NOW — real running ads, not an illustration of the product. */}
        {stripAds.length > 0 && (
          <section className="border-y border-border bg-wash">
            <div className="mx-auto w-full max-w-6xl px-6 py-14">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    On the screens now
                  </p>
                  <h2 className="mt-2 text-balance font-heading text-2xl font-bold tracking-tight sm:text-3xl">
                    Local businesses already running.
                  </h2>
                </div>
                <Link
                  href="/playing"
                  className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  See the whole rotation <ArrowRight className="size-4" />
                </Link>
              </div>
              <div className="mt-8 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {stripAds.map((ad) => (
                  <LiveAdCard key={ad.id} ad={ad} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* THE STAKES — name the problem (and the villain) before the solution. */}
        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                The problem
              </p>
              <h2 className="mt-2 text-balance font-heading text-2xl font-bold tracking-tight sm:text-3xl">
                Local advertising shouldn&apos;t be a guessing game.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm text-muted-foreground">
                Advertising you can&apos;t measure is the enemy. It eats your budget, hides its
                results, and leaves you hoping instead of knowing. We built Loop to end that.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {PROBLEM.map(({ icon: Icon, title, sub }) => (
                <div
                  key={title}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-6 text-center"
                >
                  <Icon className="size-6 text-muted-foreground" />
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* VALUE PROPOSITION — the attention math: the category's truest, most
            persuasive frame for why an indoor screen out-performs the alternatives. */}
        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-6 py-10">
            <h2 className="text-center font-heading text-xl font-bold tracking-tight">
              An ad in the room beats an ad they scroll past.
            </h2>
            <div className="mt-6 grid grid-cols-2 gap-px lg:grid-cols-4">
              {WHY.map(({ icon: Icon, title, sub }) => (
                <div
                  key={title}
                  className="flex flex-col items-center gap-1.5 px-3 py-6 text-center"
                >
                  <Icon className="size-5 text-primary" />
                  <p className="font-heading text-base font-bold">{title}</p>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* THE GUIDE — empathy + authority. We understand the problem, and here's
            why we're the competent guide to get you out of it. */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Why Loop
            </p>
            <h2 className="mt-2 text-balance font-heading text-2xl font-bold tracking-tight sm:text-3xl">
              We think you deserve to see exactly what your money buys.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-sm text-muted-foreground">
              Loop Network is a local network, not a faceless billboard company. We made the thing we
              wished existed: advertising that proves itself.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {GUIDE.map(({ icon: Icon, title, sub }) => (
              <Card key={title}>
                <CardContent className="flex gap-4 p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </span>
                  <div className="space-y-0.5">
                    <p className="font-semibold">{title}</p>
                    <p className="text-sm text-muted-foreground">{sub}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* THE PLAN — three steps that remove the risk of getting started. */}
        <section id="how" className="scroll-mt-20 border-y border-border bg-wash">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <p className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
              The plan
            </p>
            <h2 className="mt-2 text-center font-heading text-2xl font-bold tracking-tight">
              Up and running on local screens.
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {STEPS.map(({ n, title, sub }) => (
                <Card key={n}>
                  <CardContent className="space-y-2 p-5">
                    {/* Solid, not .text-gold-metallic: a 14px numeral is too small
                        to carry a gradient and just read as washed out. */}
                    <span className="grid size-8 place-items-center rounded-full bg-primary/10 font-bold text-primary">
                      {n}
                    </span>
                    <p className="font-semibold">{title}</p>
                    <p className="text-sm text-muted-foreground">{sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-8 text-center">
              <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
                Start advertising
              </Link>
            </div>
          </div>
        </section>

        {/* WHERE IT RUNS — the actual businesses, named. Links to the full map. */}
        {venues.length > 0 && (
          <section className="mx-auto w-full max-w-6xl px-6 py-16">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Where it runs
              </p>
              <h2 className="mt-2 text-balance font-heading text-2xl font-bold tracking-tight sm:text-3xl">
                {venues.length} local {venues.length === 1 ? 'business' : 'businesses'}, and
                counting.
              </h2>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {venues.map((v) => (
                <span
                  key={v.id}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground"
                >
                  {v.name}
                </span>
              ))}
            </div>
            <div className="mt-7 text-center">
              <Link
                href="/directory"
                className="text-sm font-medium text-primary hover:underline"
              >
                See them on the map →
              </Link>
            </div>
          </section>
        )}

        <InstallGallery />

        {/* SUCCESS — the transformation. Stakes resolved, hero wins. */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-8 text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                What changes
              </p>
              <h2 className="text-balance font-heading text-2xl font-bold tracking-tight sm:text-3xl">
                Stop guessing. Start knowing.
              </h2>
              <p className="text-pretty text-sm text-muted-foreground">
                Become the local spot people keep seeing, and keep walking into, while you see
                exactly where and when your ad plays. That&apos;s what advertising should feel like.
              </p>
              <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), 'mt-2')}>
                Start advertising <ArrowRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        </section>

        {/* PRICE — published on purpose; the franchise competitors all hide it. */}
        <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 pb-16">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Simple, public pricing
              </p>
              <p className="font-heading text-4xl font-extrabold">
                <span className="text-xl font-bold text-muted-foreground">as low as </span>
                {formatCents(lowestCents)}
                <span className="text-xl font-bold text-muted-foreground"> / location / month</span>
              </p>

              {/* The whole ladder, published. Putting the single location next to
                  the five-location rate IS the pitch: the more businesses you're
                  in, the cheaper every one of them gets. */}
              <div className="grid w-full max-w-lg gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
                {rateRows.map((r) => (
                  <div key={r.label} className="flex flex-col gap-0.5 bg-card px-4 py-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {r.label}
                    </span>
                    <span className="font-heading text-2xl font-bold">
                      {formatCents(r.eachCents)}
                      <span className="text-sm font-bold text-muted-foreground"> each</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatCents(r.eachCents * r.count)}/mo{r.plus ? ` for ${r.count}` : ''}
                    </span>
                  </div>
                ))}
              </div>

              {freeRung && (
                <p className="font-heading text-lg font-bold text-primary">
                  Buy {freeRung - 1} locations and the {ordinal(freeRung)} is free.
                </p>
              )}

              <p className="max-w-md text-sm text-muted-foreground">
                One price per business, and it covers every screen inside it, so a place with three
                TVs costs the same as a place with one. Every location costs the same too, so you
                pick by the businesses you want, not by tier
                {freeRung
                  ? `, and every location past your ${ordinal(freeRung)} is ${formatCents(lowestCents)}`
                  : ''}
                . No minimum, month to month, cancel anytime, and we can design your ad if you need
                it. You always see the price before you buy.
              </p>
              <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
                Start advertising
              </Link>
            </CardContent>
          </Card>
        </section>

        {/* Two-audience fork — advertiser (primary hero) + host (secondary). */}
        <section className="mx-auto grid w-full max-w-6xl gap-4 px-6 pb-16 md:grid-cols-2">
          <Card>
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <MonitorPlay className="size-6 text-primary" />
              <div className="space-y-1">
                <h3 className="font-heading text-lg font-bold">Advertise on local screens</h3>
                <p className="text-sm text-muted-foreground">
                  Reach people where they already are, and see it. You get proof of every play,
                  exactly where and when your ad ran, with a QR code on every ad.
                </p>
              </div>
              <ul className="space-y-1.5 text-sm">
                {[
                  'Pick venues on a map, by the screen',
                  'Month to month, cancel anytime',
                  'Proof of every play, by venue and time',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), 'mt-auto w-full')}>
                Start advertising
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <Gift className="size-6 text-primary" />
              <div className="space-y-1">
                <h3 className="font-heading text-lg font-bold">Host a screen, free</h3>
                <p className="text-sm text-muted-foreground">
                  Put a TV up and we keep it interesting: trivia, a leaderboard, and clean local ads.
                  It costs you nothing, and you get free promo slots on other Loop screens around
                  town.
                </p>
              </div>
              <ul className="space-y-1.5 text-sm">
                {[
                  'Free to host, free entertainment on your TV',
                  'Free promo slots on other Loop screens',
                  'We handle setup, content, and support',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup/host"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-auto w-full')}
              >
                Host a screen
              </Link>
            </CardContent>
          </Card>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
