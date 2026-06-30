import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Eye, MapPin, Ban, MonitorPlay, QrCode, Gift, Check } from 'lucide-react'
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

const ATTENTION = [
  { icon: Eye, stat: '~90 sec', label: 'average dwell time on the screen' },
  { icon: MapPin, stat: '3 to 6 ft', label: 'from your customer, not a highway away' },
  { icon: Ban, stat: 'No skip', label: 'no scroll, no ad-block, 100% share of voice' },
  { icon: MonitorPlay, stat: '45x', label: 'the attention of a highway billboard' },
]

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
    sub: 'Your ad runs in minutes, and a QR on it tracks every scan so you know it works.',
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

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:gap-12 lg:py-20">
        <div className="text-center lg:text-left">
          <span className="inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            Indoor TV advertising, done right
          </span>
          <h1 className="mt-5 text-balance font-heading text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
            Get seen <span className="text-gold-metallic">where people go.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground lg:mx-0">
            We put your business on the TVs in the busiest bars, gyms, and shops in town, then show
            you exactly who&apos;s seeing it. You pick the spots, we handle the rest.
          </p>
          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}
            >
              Start advertising
            </Link>
            <Link
              href="/signup?role=host"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full sm:w-auto')}
            >
              Host a screen
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

      {/* Attention math — the category's most persuasive, and entirely true, frame */}
      <section className="border-y border-border bg-card/30">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-px px-6 py-2 lg:grid-cols-4">
          {ATTENTION.map(({ icon: Icon, stat, label }) => (
            <div key={stat} className="flex flex-col items-center gap-1 px-3 py-6 text-center">
              <Icon className="size-5 text-primary" />
              <p className="font-heading text-xl font-bold">{stat}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16">
        <p className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
          How it works
        </p>
        <h2 className="mt-2 text-center font-heading text-2xl font-bold tracking-tight">
          Live on local screens in minutes
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
      </section>

      {/* Pricing — published on purpose; the franchise competitors all hide it */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-16">
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Simple, public pricing
            </p>
            <p className="font-heading text-4xl font-extrabold">
              $50<span className="text-xl font-bold text-muted-foreground"> / TV / month</span>
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Start from a $200/mo minimum, cancel anytime, and we&apos;ll design your ad for you.
              No contracts, no &quot;request a media kit.&quot; You always see the price before you buy.
            </p>
            <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
              Start advertising
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* Two-audience fork */}
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
                'Competitors can never share your screens',
                'Every scan tracked back to its venue',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'mt-auto w-full')}
            >
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
              href="/signup?role=host"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-auto w-full')}
            >
              Host a screen
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* Honest social proof — where it runs, no invented logos or counts */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-20 text-center">
        <p className="text-sm text-muted-foreground">
          Running on local screens in bars, gyms, barbershops, restaurants, and cafés around
          Jacksonville, NC.
        </p>
      </section>

      {/* Footer */}
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
          <p className="text-xs text-muted-foreground">
            © {year} Loop Network LLC
          </p>
        </div>
      </footer>
    </main>
  )
}
