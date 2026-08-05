import type { Metadata } from 'next'
import Link from 'next/link'
import { MessageSquare, Clock, Ban } from 'lucide-react'
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'
import { InquiryForm } from './InquiryForm'

export const metadata: Metadata = {
  title: 'Talk to us',
  description:
    'Advertise on Loop Network screens, or put a screen in your venue. Tell us which and we will get back to you.',
}

// The one place on the public site where a stranger can start a conversation.
//
// Everything else here sells self-serve: pick screens, pay, go live. That works
// for the people who already understand the product. The ones worth the most
// have a question first, and until now there was nowhere for them to ask it
// short of finding an email address.
//
// A submission lands directly on the sales board as an opportunity with a
// follow-up already due, because an inbound enquiry that sits unnoticed for
// three days is worse than not having the form.

export default async function AdvertisePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  const { kind } = await searchParams
  const defaultKind = kind === 'host' ? 'host' : 'advertiser'

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 md:py-14">
        <h1 className="font-heading text-3xl font-bold tracking-tight md:text-4xl">
          Talk to a person
        </h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Whether you want your ad on our screens or a screen in your venue, tell us a bit and we
          will come back to you. No account, no sales sequence.
        </p>

        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_15rem] md:items-start">
          <InquiryForm defaultKind={defaultKind} />

          <aside className="space-y-4 text-sm">
            <Point icon={Clock} title="We reply">
              Enquiries go straight to the person who runs the network, not a queue.
            </Point>
            <Point icon={Ban} title="No contract to advertise">
              Month to month. Published rates, on the{' '}
              <Link href="/#pricing" className="text-primary hover:underline">
                pricing section
              </Link>
              .
            </Point>
            <Point icon={MessageSquare} title="Rather just look first?">
              <Link href="/preview" className="text-primary hover:underline">
                Preview your ad
              </Link>{' '}
              on a screen, or see{' '}
              <Link href="/playing" className="text-primary hover:underline">
                what is running right now
              </Link>
              .
            </Point>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

function Point({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Clock
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 font-medium">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
        {title}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>
    </div>
  )
}
