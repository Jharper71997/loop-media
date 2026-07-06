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
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-heading font-bold tracking-[0.16em] text-foreground', className)}>
      LOOP <span className="text-gold-metallic">NETWORK</span>
    </span>
  )
}

// A pure-CSS "wall TV" so the hero shows the actual product without a stock photo.
function TvMockup() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-white/10 bg-black p-2 shadow-2xl shadow-black/60">
        <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-[#211d14] via-[#15130d] to-black">
          <span className="absolute left-3 top-2.5 text-[0.6rem] font-semibold tracking-[0.2em] text-primary">
            LOOP NETWORK
          </span>
          <span className="absolute right-3 top-2.5 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[0.55rem] text-foreground">
            <span className="size-1.5 rounded-full bg-success" /> Trivia live
          </span>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center">
            <span className="text-[0.6rem] uppercase tracking-[0.2em] text-primary/80">Now showing</span>
            <p className="font-heading text-xl font-extrabold text-foreground">Coastal Coffee Co.</p>
            <p className="text-xs text-muted-foreground">$2 off any latte this week</p>
            <span className="mt-1.5 grid size-12 place-items-center rounded-md bg-foreground text-background">
              <QrCode className="size-9" />
            </span>
            <span className="text-[0.6rem] text-muted-foreground">Scan to redeem</span>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-1 h-3 w-16 rounded-b-md bg-white/5" />
    </div>
  )
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
    sub: 'A QR code on each ad ties the screen to real customer scans, so you see exactly what works.',
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
    sub: 'Your ad goes live once it clears a quick review, and a QR on it tracks every scan so you know it works.',
  },
]

export default async function Home() {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  const year = new Date().getFullYear()

  return (
    <main className="flex flex-1 flex-col">
      {/* Top bar */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark className="text-base" />
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
          Log in
        </Link>
      </header>

      {/* HEADER / HERO — grunt test: what you offer, how life improves, what to do.
          The customer (the local business owner) is the hero; Loop is the guide. */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:gap-12 lg:py-20">
        <div className="text-center lg:text-left">
          <span className="inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            Indoor TV advertising you can actually measure
          </span>
          <h1 className="mt-5 text-balance font-heading text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
            Your business, on the screens your customers{' '}
            <span className="text-gold-metallic">already watch.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground lg:mx-0">
            Loop Network puts your ad on the TVs in the busiest local bars, gyms, and shops, with a
            QR code on every ad that tracks real scans. So you finally know which ads bring customers
            in, and which don&apos;t.
          </p>
          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
            <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}>
              Start advertising
            </Link>
            <Link
              href="#how"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'w-full sm:w-auto'
              )}
            >
              See how it works
            </Link>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground lg:justify-start">
            {['$50 / TV / month', 'Month to month', "We'll design your ad"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-primary" /> {t}
              </span>
            ))}
          </div>
        </div>
        <TvMockup />
      </section>

      {/* THE STAKES — name the problem (and the villain) before the solution. */}
      <section className="border-t border-border bg-card/30">
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
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background/40 p-6 text-center"
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
      <section className="border-y border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-10">
          <h2 className="text-center font-heading text-xl font-bold tracking-tight">
            An ad in the room beats an ad they scroll past.
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-px lg:grid-cols-4">
            {WHY.map(({ icon: Icon, title, sub }) => (
              <div key={title} className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
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
      <section id="how" className="border-t border-border bg-card/30 scroll-mt-20">
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
                  <span className="grid size-8 place-items-center rounded-full bg-primary/10 font-bold text-gold-metallic">
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
              Become the local spot people keep seeing, and keep walking into, while the scans add up
              in a dashboard that finally tells the truth about your marketing. That&apos;s what
              advertising should feel like.
            </p>
            <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), 'mt-2')}>
              Start advertising <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* PRICE — published on purpose; the franchise competitors all hide it. */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Simple, public pricing
            </p>
            <p className="font-heading text-4xl font-extrabold">
              $50<span className="text-xl font-bold text-muted-foreground"> / TV / month</span>
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Start from a $200/mo minimum, cancel anytime, and we&apos;ll design your ad for you. No
              contracts, no hidden rates. You always see the price before you buy.
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
                Reach people where they already are, and prove it. QR scans tie every screen to a
                real customer action, so you know exactly what&apos;s working.
              </p>
            </div>
            <ul className="space-y-1.5 text-sm">
              {[
                'Pick venues on a map, by the screen',
                'Month to month, cancel anytime',
                'Every scan tracked back to its venue',
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
                It costs you nothing, and you get free promo slots on other Loop screens around town.
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
              href="/host/register"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-auto w-full')}
            >
              Host a screen
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* Honest social proof — where it runs, no invented logos or counts. */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-20 text-center">
        <p className="text-sm text-muted-foreground">
          Built for local screens in bars, gyms, barbershops, restaurants, and cafés around
          Jacksonville, NC.
        </p>
      </section>

      {/* Junk drawer / footer */}
      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <Wordmark className="text-sm" />
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">© {year} Loop Network LLC</p>
        </div>
      </footer>
    </main>
  )
}
