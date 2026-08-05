import type { Metadata } from 'next'
import Link from 'next/link'
import { MonitorPlay, QrCode, ArrowRight } from 'lucide-react'
import { getLiveAds } from '@/lib/liveAds'
import { createAdminClient } from '@/lib/supabase/admin'
import { buttonVariants } from '@/components/ui/button'
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'
import { LiveAdCard } from '@/components/site/LiveAdCard'
import { InstallGallery } from '@/components/site/InstallGallery'
import { cn } from '@/lib/utils'

// Always current — this page's entire claim is "right now".
export const dynamic = 'force-dynamic'

// The brand is NOT in the title: the layout template already appends
// " — Loop Network", so spelling it here rendered as "On the screens right now
// — Loop Network — Loop Network" in the tab and in search results.
export const metadata: Metadata = {
  title: 'On the screens right now',
  description:
    'The real ads playing on Loop Network screens in local bars, gyms and shops around Jacksonville, NC, right now.',
  alternates: { canonical: '/playing' },
}

export default async function PlayingPage() {
  const admin = createAdminClient()
  const [ads, { count: venueCount }] = await Promise.all([
    getLiveAds(),
    admin
      .from('venues')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .eq('is_demo', false),
  ])

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <section className="bg-wash-radial">
          <div className="mx-auto w-full max-w-3xl px-6 pt-12 pb-8 text-center lg:pt-16">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              Live on the network
            </span>
            <h1 className="mt-5 text-balance font-heading text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
              What&apos;s on the screens{' '}
              <span className="text-gold-metallic">right now.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-pretty text-base text-muted-foreground">
              {ads.length > 0
                ? `Every ad below is playing today on Loop screens across ${venueCount ?? 0} local businesses. This is the whole rotation, not a highlight reel.`
                : 'The ads currently running on Loop screens will show up here.'}
            </p>
          </div>
        </section>

        {ads.length > 0 ? (
          <section className="mx-auto w-full max-w-6xl px-6 pb-14">
            <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {ads.map((ad) => (
                <LiveAdCard key={ad.id} ad={ad} />
              ))}
            </div>
            <p className="mt-10 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
              <QrCode className="size-3.5 shrink-0" />
              Every ad carries its own scan code, so the business running it can count who acted on
              it.
            </p>
          </section>
        ) : (
          <section className="mx-auto w-full max-w-6xl px-6 pb-14">
            <div className="grid place-items-center rounded-2xl border border-border py-16 text-center">
              <MonitorPlay className="size-7 text-muted-foreground" />
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                Nothing is on the screens at this moment. Check back shortly.
              </p>
            </div>
          </section>
        )}

        <InstallGallery />

        <section className="border-t border-border">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-16 text-center">
            <h2 className="text-balance font-heading text-2xl font-bold tracking-tight">
              Yours could be in this rotation next week.
            </h2>
            <p className="max-w-md text-pretty text-sm text-muted-foreground">
              Pick the screens you want on a map, add your ad or have us design one, and go live from
              $50 a screen a month.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
                Start advertising <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/preview"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
              >
                See your ad on a TV first
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
