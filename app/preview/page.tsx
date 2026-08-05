import type { Metadata } from 'next'
import Link from 'next/link'
import { Upload, MonitorPlay, QrCode, ArrowRight } from 'lucide-react'
import { PreviewStudio, type PreviewSample } from '@/components/app/PreviewStudio'
import { getLiveAds } from '@/lib/liveAds'
import { buttonVariants } from '@/components/ui/button'
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'
import { cn } from '@/lib/utils'

// The sample ad on the TV is whatever is actually live right now.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'See your ad on a TV before you buy — Loop Network',
  description:
    'A free tool: drop in your logo, photo, or video and see exactly how it would look on a Loop Network screen in a local bar, gym, or shop. No account, nothing saved.',
}

// What the page is FOR, said out loud. It used to open on an empty black
// rectangle and an upload prompt, which read as a widget with no stated purpose —
// a visitor had no idea why they'd bother or what happened after.
const WHY = [
  {
    icon: Upload,
    title: 'Drop in anything you have',
    sub: 'A logo, a photo of your shop, a clip off your phone. It never leaves your browser and nothing is saved.',
  },
  {
    icon: MonitorPlay,
    title: 'See it framed like the real thing',
    sub: 'The same render our TVs use, letterboxing and all, so you know what a customer would actually see.',
  },
  {
    icon: QrCode,
    title: 'Add your link, get your scan code',
    sub: 'Every Loop ad carries a QR. Type your website in and watch it appear in the corner, exactly where it airs.',
  },
]

export default async function PreviewPage() {
  // Lead with the widest-running ad — the TV should be playing something real
  // the moment the page opens.
  const [sampleAd] = await getLiveAds(1)
  const sample: PreviewSample | null = sampleAd
    ? {
        creativeUrl: sampleAd.creativeUrl,
        creativeType: sampleAd.creativeType,
        title: sampleAd.title,
      }
    : null

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <section className="bg-wash-radial">
          <div className="mx-auto w-full max-w-3xl px-6 pt-12 pb-6 text-center lg:pt-16">
            <span className="inline-block rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
              Free tool · no sign-up · nothing saved
            </span>
            <h1 className="mt-5 text-balance font-heading text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
              See your ad on a TV{' '}
              <span className="text-gold-metallic">before you spend a dollar.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-pretty text-base text-muted-foreground">
              Most people can&apos;t picture their business on a screen in a bar, so they never try
              it. Drop in a logo or a photo below and the TV shows you in about two seconds, framed
              exactly the way it plays on Loop screens around town.
            </p>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-8 lg:py-12">
          <PreviewStudio sample={sample} />
        </section>

        <section className="border-y border-border bg-wash">
          <div className="mx-auto w-full max-w-6xl px-6 py-14">
            <h2 className="text-center font-heading text-xl font-bold tracking-tight">
              What this page is for.
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {WHY.map(({ icon: Icon, title, sub }) => (
                <div
                  key={title}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-6 text-center"
                >
                  <span className="grid size-10 place-items-center rounded-full bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </span>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-16 text-center">
          <h2 className="text-balance font-heading text-2xl font-bold tracking-tight">
            Happy with how it looks?
          </h2>
          <p className="max-w-md text-pretty text-sm text-muted-foreground">
            Pick your screens on a map and go live from $50 a screen a month. No ad ready? Our team
            designs one for you.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
              Start advertising <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/playing"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              See what&apos;s running now
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
