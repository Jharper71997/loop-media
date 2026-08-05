import type { Metadata } from 'next'
import Link from 'next/link'
import { MapPin, MonitorPlay, Flame } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTvLive } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SiteHeader } from '@/components/site/SiteHeader'
import { SiteFooter } from '@/components/site/SiteFooter'
import DirectoryMap, { type DirectoryMapVenue } from './DirectoryMap'
import { JsonLd } from '@/components/site/JsonLd'
import { SITE_REGION, absoluteUrl } from '@/lib/site'
import { venueSlugMap } from '@/lib/venueSlug'

// Read at request time (service-role fetch, always current) — never baked at build.
export const dynamic = 'force-dynamic'

// Names the market in the title: "local businesses" alone matches nothing a
// person would type, and this page's whole advantage is that it lists real
// Jacksonville businesses by name.
export const metadata: Metadata = {
  // Kept short on purpose: the layout template appends " — Loop Network", and
  // Google truncates a title tag around 60 characters. This lands at 53.
  title: `Where Your Ad Runs in ${SITE_REGION}`,
  description:
    `Every bar, gym, shop and restaurant with a Loop Network screen in ${SITE_REGION}, ranked by how busy they are. See the map and pick the screens your ad runs on.`,
  alternates: { canonical: '/directory' },
  openGraph: {
    title: `Where Loop Screens Are in ${SITE_REGION}`,
    description: `Every local business with a Loop Network screen in ${SITE_REGION}, on a map.`,
    url: absoluteUrl('/directory'),
    type: 'website',
  },
}

type VenueRow = {
  id: string
  name: string
  logo_url: string | null
  venue_type: string | null
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
  foot_traffic_estimate: number | null
  category: { name: string } | null
  tvs: { id: string; last_heartbeat_at: string | null }[]
}

type Listing = {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  type: string | null
  place: string
  lat: number | null
  lng: number | null
  /** Distinct advertisers currently running here. Our only real popularity signal. */
  advertisers: number
  live: boolean
  /** Sort input only — never rendered. 0 everywhere until hosts are surveyed. */
  traffic: number
}

// Public, no-account directory of the businesses on the network. Read via the
// service-role client (venues aren't readable under anon RLS) but scoped to only
// safe public fields, active + non-demo venues — no host or pricing data.
//
// RANKING: sorted by demand, busiest first, because an alphabetical list told a
// visitor nothing (and buried whichever venue happened to start with a Z).
// `foot_traffic_estimate` leads when it's actually set — it is 0 across the board
// today, so in practice the tiebreaker does the work: the number of DISTINCT
// advertisers currently running on that venue's screens. That's a measured fact,
// not an estimate, and it is already public in the sense that anyone sitting in
// the room can watch the loop. The raw traffic figure itself is never printed.
export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const { sort } = await searchParams
  const alpha = sort === 'az'

  const admin = createAdminClient()
  const { data } = await admin
    .from('venues')
    .select(
      'id, name, logo_url, venue_type, city, state, lat, lng, foot_traffic_estimate, category:categories(name), tvs(id, last_heartbeat_at)'
    )
    .eq('status', 'active')
    .eq('is_demo', false)
  const rows = (data ?? []) as unknown as VenueRow[]

  // One pass over active placements → distinct advertisers per venue.
  const tvIds = rows.flatMap((r) => r.tvs?.map((t) => t.id) ?? [])
  const adsByVenue = new Map<string, Set<string>>()
  if (tvIds.length) {
    const { data: placements } = await admin
      .from('ad_placements')
      .select('ad_id, tv_id')
      .in('tv_id', tvIds)
      .eq('status', 'active')
    const tvToVenue = new Map<string, string>()
    for (const r of rows) for (const t of r.tvs ?? []) tvToVenue.set(t.id, r.id)
    for (const p of (placements ?? []) as { ad_id: string | null; tv_id: string }[]) {
      const venueId = tvToVenue.get(p.tv_id)
      if (!venueId || !p.ad_id) continue
      const set = adsByVenue.get(venueId) ?? new Set<string>()
      set.add(p.ad_id)
      adsByVenue.set(venueId, set)
    }
  }

  // Built once over the whole set so duplicate names resolve consistently here
  // and on the venue page (see lib/venueSlug.ts).
  const slugs = venueSlugMap(rows)

  const listings: Listing[] = rows
    .map((v) => ({
      id: v.id,
      slug: slugs.get(v.id) as string,
      name: v.name,
      logoUrl: v.logo_url,
      type: v.category?.name ?? v.venue_type,
      place: [v.city, v.state].filter(Boolean).join(', '),
      lat: v.lat,
      lng: v.lng,
      advertisers: adsByVenue.get(v.id)?.size ?? 0,
      live: (v.tvs ?? []).some((t) => isTvLive(t.last_heartbeat_at)),
      traffic: v.foot_traffic_estimate ?? 0,
    }))
    .sort((a, b) =>
      alpha
        ? a.name.localeCompare(b.name)
        : b.traffic - a.traffic || b.advertisers - a.advertisers || a.name.localeCompare(b.name)
    )

  const geo = listings.filter((v) => v.lat != null && v.lng != null)
  const center: [number, number] = geo.length
    ? [
        geo.reduce((s, v) => s + (v.lat as number), 0) / geo.length,
        geo.reduce((s, v) => s + (v.lng as number), 0) / geo.length,
      ]
    : [34.7541, -77.4302] // Jacksonville, NC — first market
  const mapVenues: DirectoryMapVenue[] = geo.map((v) => ({
    id: v.id,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    category: v.type,
  }))
  const busiest = listings[0]?.advertisers ?? 0

  // The named local businesses, as structured data. This is the page's real
  // search asset: eleven specific Jacksonville venues that no national
  // competitor can list. Each is a Place with coordinates, which is what lets
  // Google associate this page with those business names.
  //
  // Emitted in the ranked order the page renders, since ItemList position is
  // meaningful and the default sort is by demand.
  const directorySchema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Local businesses with a Loop Network screen in ${SITE_REGION}`,
    numberOfItems: listings.length,
    itemListOrder: alpha
      ? 'https://schema.org/ItemListOrderAscending'
      : 'https://schema.org/ItemListOrderDescending',
    itemListElement: listings.map((v, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Place',
        name: v.name,
        // Points at the venue's own page, which is what turns this list from a
        // flat mention into eleven crawlable destinations.
        url: absoluteUrl(`/directory/${v.slug}`),
        ...(v.type ? { additionalType: v.type } : {}),
        ...(v.place
          ? {
              address: {
                '@type': 'PostalAddress',
                addressLocality: v.place.split(',')[0]?.trim(),
                addressRegion: v.place.split(',')[1]?.trim(),
                addressCountry: 'US',
              },
            }
          : {}),
        ...(v.lat != null && v.lng != null
          ? { geo: { '@type': 'GeoCoordinates', latitude: v.lat, longitude: v.lng } }
          : {}),
      },
    })),
  }

  return (
    <>
      <JsonLd data={directorySchema} />
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <section className="bg-wash-radial">
          <div className="mx-auto w-full max-w-3xl px-6 pt-12 pb-8 text-center lg:pt-16">
            <span className="inline-block rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
              The local network
            </span>
            <h1 className="mt-5 text-balance font-heading text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
              Local spots on the <span className="text-gold-metallic">Loop Network.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground">
              {listings.length > 0
                ? `The ${listings.length} local ${listings.length === 1 ? 'business' : 'businesses'} with a Loop screen — the places you see around town.`
                : 'The local businesses with a Loop screen will show up here.'}
            </p>
          </div>
        </section>

        {geo.length > 0 && (
          <section className="mx-auto w-full max-w-6xl px-6 pt-2">
            <DirectoryMap venues={mapVenues} center={center} />
          </section>
        )}

        <section className="mx-auto w-full max-w-6xl px-6 py-10 lg:py-14">
          {listings.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-border py-16 text-center">
              <MapPin className="size-7 text-muted-foreground" />
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                No businesses listed yet. Check back soon.
              </p>
            </div>
          ) : (
            <>
              {/* Sort control — popularity is the default, A–Z stays available for
                  anyone hunting a specific business. */}
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {alpha ? 'Listed A to Z' : 'Ranked by how many advertisers are running there'}
                </p>
                <div className="flex items-center rounded-full border border-border p-0.5">
                  <SortTab href="/directory" label="Most popular" active={!alpha} />
                  <SortTab href="/directory?sort=az" label="A–Z" active={alpha} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((v, i) => (
                  <DirectoryCard
                    key={v.id}
                    venue={v}
                    rank={alpha ? null : i + 1}
                    hottest={!alpha && i === 0 && busiest > 0}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <section className="border-t border-border bg-wash">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-6 py-14 text-center">
            <h2 className="text-balance font-heading text-xl font-bold tracking-tight sm:text-2xl">
              Want your ad on these screens?
            </h2>
            <p className="max-w-md text-pretty text-sm text-muted-foreground">
              Pick the exact venues you want on a map, from $50 a screen a month.
            </p>
            <Link
              href="/signup"
              className="mt-1 text-sm font-medium text-primary hover:underline"
            >
              Start advertising →
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

function SortTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </Link>
  )
}

function DirectoryCard({
  venue: v,
  rank,
  hottest,
}: {
  venue: Listing
  rank: number | null
  hottest: boolean
}) {
  return (
    <Link
      href={`/directory/${v.slug}`}
      className="relative flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="relative shrink-0">
        <div className="grid size-14 place-items-center overflow-hidden rounded-xl bg-muted">
          {v.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={v.logoUrl}
              alt={v.name}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <span className="font-heading text-xl font-bold text-muted-foreground">
              {v.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        {rank != null && (
          <span className="absolute -left-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground ring-2 ring-card">
            {rank}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{v.name}</p>
          {v.live && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-success"
              title="Screen online now"
              aria-label="Screen online now"
            />
          )}
        </div>
        {v.type && <p className="truncate text-sm text-muted-foreground">{v.type}</p>}
        {v.place && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            {v.place}
          </p>
        )}
        {v.advertisers > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
            {hottest ? (
              <Flame className="size-3.5 shrink-0 text-primary" />
            ) : (
              <MonitorPlay className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {v.advertisers} {v.advertisers === 1 ? 'advertiser' : 'advertisers'} running
            {hottest && <span className="text-primary"> · busiest screen</span>}
          </p>
        )}
      </div>
    </Link>
  )
}
