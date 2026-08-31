import Link from 'next/link'
import { headers } from 'next/headers'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { kioskUrl } from '@/lib/tv'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, WATCH_TABS } from '@/components/admin/SectionTabs'
import { ListSearch } from '@/components/admin/ListSearch'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { LiveStatus } from '@/components/app/LiveStatus'
import { CopyField } from '@/components/app/CopyField'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatCents, timeAgo, isTvLive } from '@/lib/format'
import { suggestTier, venuePriceCents, TIER_LABEL } from '@/lib/pricing'
import { getPricingConfig } from '@/lib/pricing.server'
import { isVenueListable } from '@/lib/venue'
import { adSlotCount, houseSlideCount, loopOccupancy } from '@/lib/loop'
import { HOUSE_SELECT, housePlays, type HouseRow } from '@/lib/houseSlides'
import { venueBusinessHours, formatBusinessHours } from '@/lib/uptime'
import type { Category, Territory, Venue, PriceTier, Tv } from '@/lib/db.types'
import { VenueDialog } from './VenueDialog'
import { VisibilityToggle } from './VisibilityToggle'
import { TriviaToggle } from './TriviaToggle'
import { deleteVenue } from './actions'
import { TvDialog } from '../tvs/TvDialog'
import { RegenerateButton } from '../tvs/RegenerateButton'
import { deleteTv } from '../tvs/actions'
import { cn } from '@/lib/utils'

const venueTier = (v: { price_tier: PriceTier | null; foot_traffic_estimate: number }): PriceTier =>
  v.price_tier ?? suggestTier(v.foot_traffic_estimate)

type VenueRow = Venue & {
  category: { name: string } | null
  territory: { name: string } | null
}

function StatusBadge({ v }: { v: VenueRow }) {
  if (v.status !== 'active') return <Badge variant="secondary">Hidden</Badge>
  if (isVenueListable(v)) return <Badge>On map</Badge>
  return <Badge variant="warning">Needs data</Badge>
}

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const { q, status } = await searchParams
  const supabase = await createClient()
  const pricingConfig = await getPricingConfig()

  // Build the kiosk-URL origin from the live request so the link a provisioner
  // copies is always for the domain they're on (NEXT_PUBLIC_APP_URL is frozen at
  // build time and easy to leave stale across renames).
  const h = await headers()
  const reqHost = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const origin = reqHost ? `${proto}://${reqHost}` : (process.env.NEXT_PUBLIC_APP_URL ?? '')

  let vq = supabase
    .from('venues')
    .select('*, category:categories(name), territory:territories(name)')
    // Demo venues never appear in the admin venue list.
    .eq('is_demo', false)
    .order('name')
  if (t) vq = vq.eq('territory_id', t)
  if (q?.trim()) vq = vq.ilike('name', `%${q.trim()}%`)
  if (status === 'active') vq = vq.eq('status', 'active')
  else if (status === 'inactive') vq = vq.eq('status', 'inactive')

  const [{ data: venues }, { data: categories }, { data: hostProfiles }, { data: houseData }] =
    await Promise.all([
      vq,
      supabase.from('categories').select('*').order('name'),
      supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('role', ['host', 'admin'])
        .eq('is_demo', false)
        .order('email'),
      // A market can switch a house slide off (0075), which changes how many
      // slides a screen there actually runs — so the slot math below has to ask.
      supabase.from('house_creatives').select(HOUSE_SELECT).eq('active', true),
    ])

  const rows = (venues ?? []) as VenueRow[]
  const houseRows = (houseData ?? []) as HouseRow[]
  const cats = (categories ?? []) as Category[]
  const territories = territory.territories as Territory[]
  const hosts = (hostProfiles ?? []) as { id: string; email: string; full_name: string | null }[]

  // The screens that live at these venues, grouped per venue, plus which ads are
  // playing on each — so every venue shows its screen(s) inline.
  const venueIds = rows.map((v) => v.id)
  const tvsByVenue = new Map<string, Tv[]>()
  const titlesByTv = new Map<string, string[]>()
  const adsByTv = new Map<string, number>()
  let allTvs: Tv[] = []
  if (venueIds.length) {
    const { data: tvData } = await supabase
      .from('tvs')
      .select('*')
      .in('venue_id', venueIds)
      .order('created_at', { ascending: false })
    allTvs = (tvData ?? []) as Tv[]
    for (const tv of allTvs) {
      const arr = tvsByVenue.get(tv.venue_id) ?? []
      arr.push(tv)
      tvsByVenue.set(tv.venue_id, arr)
    }
    const tvIds = allTvs.map((r) => r.id)
    if (tvIds.length) {
      const { data: pl } = await supabase
        .from('ad_placements')
        .select('tv_id, ad:ads(title)')
        .in('tv_id', tvIds)
        .eq('status', 'active')
        .order('slot_position')
      for (const p of (pl ?? []) as { tv_id: string; ad: { title: string } | { title: string }[] | null }[]) {
        adsByTv.set(p.tv_id, (adsByTv.get(p.tv_id) ?? 0) + 1)
        const ad = Array.isArray(p.ad) ? p.ad[0] : p.ad
        if (ad?.title) {
          const a = titlesByTv.get(p.tv_id) ?? []
          a.push(ad.title)
          titlesByTv.set(p.tv_id, a)
        }
      }
    }
  }

  const liveCount = allTvs.filter((r) => !!r.device_id && isTvLive(r.last_heartbeat_at)).length

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Venues & screens"
        description={`${rows.length} venue${rows.length === 1 ? '' : 's'} · ${liveCount} of ${allTvs.length} screen${allTvs.length === 1 ? '' : 's'} live now`}
        action={
          <VenueDialog
            categories={cats}
            territories={territories}
            hosts={hosts}
            defaultTerritoryId={t ?? ''}
            pricingConfig={pricingConfig}
          />
        }
      />
      <SectionTabs tabs={WATCH_TABS} />

      <div className="space-y-3 p-3 md:p-4">
        <ListSearch
          placeholder="Search venues by name…"
          statusOptions={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Hidden' },
          ]}
        />
        {rows.length === 0 && (
          <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            {q?.trim() || status ? 'No venues match your search.' : 'No venues yet. Add your first location.'}
          </p>
        )}

        {rows.map((v) => {
          const tier = venueTier(v)
          const hours = formatBusinessHours(venueBusinessHours(v))
          const screens = tvsByVenue.get(v.id) ?? []
          return (
            <div
              key={v.id}
              className={cn(
                'rounded-xl border border-border bg-card',
                v.status !== 'active' && 'opacity-60'
              )}
            >
              {/* Venue header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/venues/${v.id}`} className="font-medium hover:underline">
                      {v.name}
                    </Link>
                    <StatusBadge v={v} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{v.category?.name ?? v.venue_type ?? '—'}</span>
                    {!t && <span>{v.territory?.name ?? '—'}</span>}
                    <span>{formatNumber(v.foot_traffic_estimate)}/mo traffic</span>
                    <span className="font-medium text-primary">
                      {v.price_cents_override != null ? 'Custom' : TIER_LABEL[tier]} ·{' '}
                      {formatCents(venuePriceCents(v.price_cents_override, tier, pricingConfig))}/mo
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {hours}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <VisibilityToggle id={v.id} active={v.status === 'active'} />
                  <TriviaToggle id={v.id} enabled={v.trivia_enabled} />
                  <VenueDialog
                    venue={v}
                    categories={cats}
                    territories={territories}
                    hosts={hosts}
                    defaultTerritoryId={t ?? ''}
                    pricingConfig={pricingConfig}
                  />
                  <DeleteButton id={v.id} action={deleteVenue} />
                </div>
              </div>

              {/* Screens at this venue */}
              <div className="divide-y divide-border">
                {screens.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
                    <span>No screen yet. Add one to get a pairing code for the technician.</span>
                    <TvDialog venues={[]} presetVenueId={v.id} presetVenueName={v.name} />
                  </div>
                ) : (
                  screens.map((tv, i) => {
                    const occ = loopOccupancy({
                      adSlots: adSlotCount(tv.loop_length_seconds, tv.slot_seconds),
                      houseSlides: houseSlideCount({
                        triviaEnabled: v.trivia_enabled,
                        brewloop: housePlays(houseRows, 'brewloop', v.territory_id),
                        advertise: housePlays(houseRows, 'advertise', v.territory_id),
                      }),
                      paidSold: adsByTv.get(tv.id) ?? 0,
                    })
                    return (
                    <div
                      key={tv.id}
                      className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <LiveStatus
                            lastHeartbeat={tv.last_heartbeat_at}
                            paired={!!tv.device_id}
                            adsRunning={adsByTv.get(tv.id) ?? 0}
                          />
                          <Link
                            href={`/admin/tvs/${tv.id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            Screen {i + 1}
                          </Link>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="text-foreground/70">Playing: </span>
                          {(titlesByTv.get(tv.id)?.length ?? 0) > 0
                            ? (titlesByTv.get(tv.id) ?? []).join(', ')
                            : 'nothing yet'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Last seen {timeAgo(tv.last_heartbeat_at)} ·{' '}
                          <span className="tabular-nums">
                            {occ.used}/{occ.total}
                          </span>{' '}
                          slots · <span className="tabular-nums">{occ.open}</span> open
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {tv.device_id ? (
                          <CopyField
                            value={kioskUrl(origin, tv.device_id)}
                            display={`/tv?device=…${tv.device_id.slice(-6)}`}
                            label="Copy link"
                          />
                        ) : tv.pairing_code ? (
                          <CopyField
                            value={tv.pairing_code}
                            display={tv.pairing_code}
                            label="Copy code"
                          />
                        ) : (
                          <code className="rounded bg-muted px-2 py-1 font-mono text-xs">—</code>
                        )}
                        <div className="flex gap-1">
                          <RegenerateButton id={tv.id} />
                          <DeleteButton id={tv.id} action={deleteTv} />
                        </div>
                      </div>
                    </div>
                  )})
                )}
                {screens.length > 0 && (
                  <div className="flex justify-end px-4 py-2.5">
                    <TvDialog venues={[]} presetVenueId={v.id} presetVenueName={v.name} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
