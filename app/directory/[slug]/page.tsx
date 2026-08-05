import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Clock, MapPin, MonitorPlay } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatCents, isTvLive } from '@/lib/format'
import { formatOpenHours, type PerDayHours } from '@/lib/openHours'
import { perLocationCents } from '@/lib/pricing'
import { getPricingConfig } from '@/lib/pricing.server'
import { findVenueBySlug } from '@/lib/venueSlug'
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'
import { JsonLd } from '@/components/site/JsonLd'
import { absoluteUrl } from '@/lib/site'
import DirectoryMap from '../DirectoryMap'

// One page per host venue. This is the site's only genuinely defensible search
// surface: a national competitor can outspend us on "TV advertising Jacksonville
// NC", but it cannot write a page about Twin Ravens Tavern that is true.
//
// Dynamic rather than statically generated: a venue can go active, gain a
// screen, or change hands between deploys, and a stale page claiming a screen
// that isn't there is worse than a slightly slower one.
export const dynamic = 'force-dynamic'

const VENUE_COLUMNS =
  'id, name, address, city, state, postal_code, lat, lng, venue_type, price_cents_override, ' +
  'business_open, business_close, business_days, business_hours, ' +
  'category:categories(name), tvs(id, last_heartbeat_at)'

type VenueRow = {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  lat: number | null
  lng: number | null
  venue_type: string | null
  price_cents_override: number | null
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  business_hours: PerDayHours | null
  category: { name: string } | null
  tvs: { id: string; last_heartbeat_at: string | null }[] | null
}

// Every active venue, because resolving a slug means slugifying the whole set
// (see lib/venueSlug.ts). Eleven rows today; if this ever gets big enough to
// matter, that is the moment to add a real slug column and query by it.
async function activeVenues(): Promise<VenueRow[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('venues')
    .select(VENUE_COLUMNS)
    .eq('status', 'active')
    .eq('is_demo', false)
  return (data ?? []) as unknown as VenueRow[]
}

function placeOf(v: VenueRow): string {
  return [v.city, v.state].filter(Boolean).join(', ')
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const venue = findVenueBySlug(await activeVenues(), slug)
  if (!venue) return { title: 'Venue not found' }

  const place = placeOf(venue)
  const kind = (venue.category?.name ?? venue.venue_type ?? 'local business').toLowerCase()

  return {
    // `absolute`, and deliberately WITHOUT the brand suffix. "Advertise at
    // <venue> — <city, ST>" already runs to ~50 characters and appending
    // "| Loop Network" pushes it past the ~60 where Google truncates, cutting off
    // the city — which is the part doing the ranking work. Google appends a site
    // name to the result itself anyway.
    title: { absolute: `Advertise at ${venue.name}${place ? ` — ${place}` : ''}` },
    description:
      `Run your ad on the TV inside ${venue.name}${place ? `, a ${kind} in ${place}` : ''}. ` +
      `Pick this screen, see proof of every play, and cancel anytime.`,
    alternates: { canonical: `/directory/${slug}` },
    openGraph: {
      title: `Advertise at ${venue.name}`,
      description: `Your ad on the screen inside ${venue.name}${place ? `, ${place}` : ''}.`,
      url: absoluteUrl(`/directory/${slug}`),
      type: 'website',
    },
  }
}

export default async function VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [venues, pricingConfig] = await Promise.all([activeVenues(), getPricingConfig()])
  const venue = findVenueBySlug(venues, slug)
  if (!venue) notFound()

  const place = placeOf(venue)
  const kind = venue.category?.name ?? venue.venue_type ?? null
  const screens = venue.tvs?.length ?? 0
  const live = (venue.tvs ?? []).some((t) => isTvLive(t.last_heartbeat_at))
  const hours = formatOpenHours({
    business_open: venue.business_open,
    business_close: venue.business_close,
    business_days: venue.business_days,
    business_hours: venue.business_hours,
  })

  // What a single location costs, honouring a negotiated override. Deliberately
  // the one-location rung: someone landing here is looking at one screen, and
  // quoting the volume rate would be a number they can't actually get.
  const priceCents = venue.price_cents_override ?? perLocationCents(1, pricingConfig)

  const hasGeo = venue.lat != null && venue.lng != null

  // The page's primary entity is the VENUE, described as a Place — not as a
  // LocalBusiness we operate. We don't own this business and shouldn't emit
  // markup implying we do; the advertising Offer below is ours and says so.
  const venueSchema = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    '@id': absoluteUrl(`/directory/${slug}#place`),
    name: venue.name,
    ...(kind ? { additionalType: kind } : {}),
    url: absoluteUrl(`/directory/${slug}`),
    ...(venue.address || place
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(venue.address ? { streetAddress: venue.address } : {}),
            ...(venue.city ? { addressLocality: venue.city } : {}),
            ...(venue.state ? { addressRegion: venue.state } : {}),
            ...(venue.postal_code ? { postalCode: venue.postal_code } : {}),
            addressCountry: 'US',
          },
        }
      : {}),
    ...(hasGeo
      ? { geo: { '@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng } }
      : {}),
  }

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: 'Where your ad runs', item: absoluteUrl('/directory') },
      { '@type': 'ListItem', position: 3, name: venue.name, item: absoluteUrl(`/directory/${slug}`) },
    ],
  }

  return (
    <>
      <JsonLd data={venueSchema} />
      <JsonLd data={breadcrumbSchema} />
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <section className="bg-wash-radial">
          <div className="mx-auto w-full max-w-3xl px-6 pt-8 pb-8 text-center lg:pt-12">
            <Link
              href="/directory"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> All locations
            </Link>

            <h1 className="mt-5 text-balance font-heading text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
              Advertise at <span className="text-gold-metallic">{venue.name}</span>
            </h1>

            <p className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              {kind && <span>{kind}</span>}
              {kind && place && <span aria-hidden>·</span>}
              {place && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> {place}
                </span>
              )}
              {live && (
                <>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-success" />
                    </span>
                    Screen is on right now
                  </span>
                </>
              )}
            </p>

            <p className="mx-auto mt-5 max-w-lg text-pretty text-base text-muted-foreground">
              {screens > 0
                ? `There ${screens === 1 ? 'is a Loop screen' : `are ${screens} Loop screens`} inside ${venue.name}. Your ad plays on ${screens === 1 ? 'it' : 'them'} in rotation, with a QR code in the corner, in front of people who are already in the room.`
                : `${venue.name} is on the Loop Network. Your ad plays on the screen inside, with a QR code in the corner, in front of people who are already in the room.`}
            </p>

            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}>
                Advertise here <ArrowRight className="size-4" />
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
          </div>
        </section>

        <section className="mx-auto w-full max-w-3xl px-6 py-10">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="flex flex-col gap-1 p-5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  This location
                </span>
                <span className="font-heading text-2xl font-bold">
                  {formatCents(priceCents)}
                  <span className="text-sm font-bold text-muted-foreground"> / month</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  Covers every screen in the building. Month to month.
                </span>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col gap-1 p-5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <MonitorPlay className="size-3.5" /> Screens
                </span>
                <span className="font-heading text-2xl font-bold">{screens || '—'}</span>
                <span className="text-xs text-muted-foreground">
                  {screens === 1 ? 'One TV, in the main room.' : 'Every screen in the building.'}
                </span>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col gap-1 p-5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Clock className="size-3.5" /> Open
                </span>
                <span className="font-heading text-base font-bold leading-snug">
                  {hours ?? 'Hours vary'}
                </span>
                <span className="text-xs text-muted-foreground">
                  Your ad runs while the doors are open.
                </span>
              </CardContent>
            </Card>
          </div>
        </section>

        {hasGeo && (
          <section className="mx-auto w-full max-w-3xl px-6 pb-10">
            <DirectoryMap
              venues={[
                {
                  id: venue.id,
                  name: venue.name,
                  lat: venue.lat,
                  lng: venue.lng,
                  category: kind,
                },
              ]}
              center={[venue.lat as number, venue.lng as number]}
            />
          </section>
        )}

        <section className="mx-auto w-full max-w-3xl px-6 pb-16">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <h2 className="text-balance font-heading text-2xl font-bold tracking-tight">
                Put your ad on the screen at {venue.name}.
              </h2>
              <ul className="mt-1 space-y-1.5 text-left text-sm">
                {[
                  'Proof of every play, by screen and time',
                  'A QR code on your ad, so a glance becomes a scan',
                  'Month to month, cancel anytime',
                  "No ad ready? We'll design one for you",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), 'mt-3')}>
                Advertise here <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/playing"
                className="text-sm font-medium text-primary hover:underline"
              >
                See what&apos;s already running →
              </Link>
            </CardContent>
          </Card>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
