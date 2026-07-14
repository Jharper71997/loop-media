import type { Metadata } from 'next'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import DirectoryMap, { type DirectoryMapVenue } from './DirectoryMap'

// Read at request time (service-role fetch, always current) — never baked at build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Local businesses on Loop Network',
  description:
    'The local businesses that make up the Loop Network — the bars, gyms, shops and restaurants with a Loop screen.',
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-heading font-bold tracking-[0.16em] text-foreground', className)}>
      LOOP <span className="text-gold-metallic">NETWORK</span>
    </span>
  )
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
  category: { name: string } | null
}

// Public, no-account directory of the businesses on the network. Read via the
// service-role client (venues aren't readable under anon RLS) but scoped to only
// safe public fields, active + non-demo venues — no host, pricing, or traffic data.
export default async function DirectoryPage() {
  const admin = createAdminClient()
  const { data } = await admin
    .from('venues')
    .select('id, name, logo_url, venue_type, city, state, lat, lng, category:categories(name)')
    .eq('status', 'active')
    .eq('is_demo', false)
    .order('name')
  const venues = (data ?? []) as unknown as VenueRow[]

  const geo = venues.filter((v) => v.lat != null && v.lng != null)
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
    category: v.category?.name ?? v.venue_type ?? null,
  }))

  const year = new Date().getFullYear()

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/">
          <Wordmark className="text-base" />
        </Link>
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
          Log in
        </Link>
      </header>

      <section className="mx-auto w-full max-w-3xl px-6 pt-8 text-center lg:pt-12">
        <span className="inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          The local network
        </span>
        <h1 className="mt-5 text-balance font-heading text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
          Local spots on the{' '}
          <span className="text-gold-metallic">Loop Network.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground">
          {venues.length > 0
            ? `The ${venues.length} local ${venues.length === 1 ? 'business' : 'businesses'} with a Loop screen — the places you see around town.`
            : 'The local businesses with a Loop screen will show up here.'}
        </p>
      </section>

      {geo.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-6 pt-8">
          <DirectoryMap venues={mapVenues} center={center} />
        </section>
      )}

      <section className="mx-auto w-full max-w-6xl px-6 py-10 lg:py-14">
        {venues.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-border py-16 text-center">
            <MapPin className="size-7 text-muted-foreground" />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              No businesses listed yet. Check back soon.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {venues.map((v) => (
              <DirectoryCard key={v.id} venue={v} />
            ))}
          </div>
        )}
      </section>

      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <Wordmark className="text-sm" />
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <Link href="/preview" className="hover:text-foreground">
              See your ad on a TV
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Start advertising
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">© {year} Loop Network LLC</p>
        </div>
      </footer>
    </main>
  )
}

function DirectoryCard({ venue: v }: { venue: VenueRow }) {
  const place = [v.city, v.state].filter(Boolean).join(', ')
  const category = v.category?.name ?? v.venue_type
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card/60 p-4">
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
        {v.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.logo_url}
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
      <div className="min-w-0">
        <p className="truncate font-medium">{v.name}</p>
        {category && <p className="truncate text-sm text-muted-foreground">{category}</p>}
        {place && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            {place}
          </p>
        )}
      </div>
    </div>
  )
}
