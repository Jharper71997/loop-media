import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ArrowLeft, ImageOff, MonitorPlay } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { kioskUrl, pairingUrl } from '@/lib/tv'
import { PageHeader } from '@/components/admin/PageHeader'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime, timeAgo, formatNumber } from '@/lib/format'
import { isWithinOpenHours, localDate, formatOpenHours } from '@/lib/openHours'
import { LiveStatus } from '@/components/app/LiveStatus'
import { CopyField } from '@/components/app/CopyField'
import { AutoRefresh } from '@/components/app/AutoRefresh'
import type { Tv } from '@/lib/db.types'
import { RegenerateButton } from '../RegenerateButton'
import { deleteTv } from '../actions'
import { loopOccupancy } from '@/lib/loop'
import {
  RemovePlacementButton,
  AddPlacement,
  AdDurationField,
  SetAllDurations,
  HouseDurationField,
  OverscanControl,
  LoopConfig,
} from './TvControls'

type TvFull = Tv & {
  // The generated Tv type predates the per-device secret (migration 0036), so the
  // "Watch screen" preview link (which must carry ?secret= to read the loop) names
  // it explicitly here.
  device_secret: string | null
  venue: {
    id: string
    name: string
    territory_id: string
    trivia_enabled: boolean | null
    business_open: string | null
    business_close: string | null
    business_days: number[] | null
    business_hours: Record<string, { open: string; close: string }> | null
  } | null
}

type ProvisioningInfo = {
  wifi_ssid: string | null
  wifi_password: string | null
  network_type: string | null
  network_note: string | null
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}

export default async function TvDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const supabase = await createClient()

  // Kiosk-URL origin from the live request (see admin/tvs list for why).
  const h = await headers()
  const reqHost = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const origin = reqHost ? `${proto}://${reqHost}` : (process.env.NEXT_PUBLIC_APP_URL ?? '')

  const { data: tvData } = await supabase
    .from('tvs')
    .select('*, venue:venues(id, name, territory_id, trivia_enabled, business_open, business_close, business_days, business_hours)')
    .eq('id', id)
    .maybeSingle()
  if (!tvData) notFound()
  const tv = tvData as unknown as TvFull

  // Network details live in a service-role-only table (the WiFi password is a
  // secret), so read them with the admin client — this page is requireAdmin-gated.
  let provisioning: ProvisioningInfo | null = null
  if (tv.venue?.id) {
    const { data: prov } = await createAdminClient()
      .from('venue_provisioning')
      .select('wifi_ssid, wifi_password, network_type, network_note')
      .eq('venue_id', tv.venue.id)
      .maybeSingle()
    provisioning = (prov as ProvisioningInfo | null) ?? null
  }

  const maxSlots = Math.max(1, Math.floor(tv.loop_length_seconds / tv.slot_seconds))

  // Current loop: active placements in slot order.
  const { data: plData } = await supabase
    .from('ad_placements')
    .select('id, slot_position, ad:ads(id, title, creative_type, creative_url, status, owner_user_id, duration_seconds)')
    .eq('tv_id', id)
    .eq('status', 'active')
    .order('slot_position')
  type PRow = {
    id: string
    slot_position: number
    ad: {
      id: string
      title: string
      creative_type: 'video' | 'image'
      creative_url: string | null
      status: string
      owner_user_id: string
      duration_seconds: number
    } | null
  }
  const placements = (plData ?? []) as unknown as PRow[]

  // Advertiser names for the playing ads.
  const ownerIds = [...new Set(placements.map((p) => p.ad?.owner_user_id).filter((x): x is string => !!x))]
  const ownerName = new Map<string, string>()
  if (ownerIds.length) {
    const { data: owners } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ownerIds)
    for (const o of owners ?? []) ownerName.set(o.id, o.full_name ?? o.email)
  }

  // Candidate ads to add manually: approved/active ads in this venue's market not
  // already on this screen.
  const onScreen = new Set(placements.map((p) => p.ad?.id).filter(Boolean))
  let candidates: { id: string; label: string }[] = []
  if (tv.venue?.territory_id) {
    const { data: ads } = await supabase
      .from('ads')
      .select('id, title')
      .eq('territory_id', tv.venue.territory_id)
      .in('status', ['approved', 'active'])
      .order('title')
    candidates = (ads ?? [])
      .filter((a) => !onScreen.has(a.id))
      .map((a) => ({ id: a.id, label: a.title }))
  }

  const used = placements.length
  const open = Math.max(0, maxSlots - used)

  // Slides the app ALWAYS injects on top of paid ads, so "used of maxSlots" (paid
  // inventory) isn't everything on the TV. The Brew Loop ad + "Advertise here" card
  // always play, the trivia teaser plays where trivia is on, plus any authored
  // filler cards for this territory. Each is fixed-time (15s, trivia 22s) and is
  // NOT a paid slot. We list them as rows below so the admin matches the real screen.
  // The fallbacks mirror the player's (FILLER_SECONDS in app/tv/TvPlayer.tsx) so a
  // screen with no stored value reads here exactly as it plays.
  const houseSlides: { kind: string; label: string; seconds: number }[] = [
    { kind: 'brewloop', label: 'Brew Loop ad', seconds: tv.brewloop_seconds ?? 15 },
    { kind: 'advertise', label: '“Advertise on this screen” card', seconds: tv.advertise_seconds ?? 15 },
  ]
  if (tv.venue?.trivia_enabled)
    houseSlides.push({ kind: 'trivia', label: 'Trivia teaser', seconds: tv.trivia_slide_seconds ?? 30 })
  if (tv.venue?.territory_id) {
    const { data: fillerRows } = await supabase
      .from('filler_content')
      .select('type, payload, expires_at')
      .eq('territory_id', tv.venue.territory_id)
      .eq('active', true)
    const nowMs = new Date().getTime()
    for (const f of (fillerRows ?? []) as {
      type: string
      payload: { headline?: string } | null
      expires_at: string | null
    }[]) {
      if (f.type === 'trivia') continue // static trivia retired; the live teaser above covers it
      if (f.expires_at && new Date(f.expires_at).getTime() <= nowMs) continue
      houseSlides.push({ kind: 'filler', label: f.payload?.headline || 'Featured card', seconds: tv.filler_seconds ?? 15 })
    }
  }
  // Loop occupancy with the always-on house slides counted as filled: `used` and
  // `total` include them; `open` is the sellable remainder advertisers can buy.
  const houseSeconds = houseSlides.reduce((s, h) => s + h.seconds, 0)
  const occ = loopOccupancy({ adSlots: maxSlots, houseSlides: houseSlides.length, paidSold: used })

  // Seed the "apply to all" box with the first image ad's current time (else the
  // screen's slot length) so it opens on a sensible value.
  const firstAdSeconds =
    placements.find((p) => p.ad && p.ad.creative_type !== 'video')?.ad?.duration_seconds ??
    tv.slot_seconds

  // ---- proof of play: uptime today + ad plays today/this month ----
  // Counts are scoped to the venue's OPEN hours and bucketed by the venue's
  // local day — a play at 3am with the screen left on isn't a real impression,
  // so counting it would overstate what advertisers bought.
  const venueHours = {
    business_open: tv.venue?.business_open ?? null,
    business_close: tv.venue?.business_close ?? null,
    business_days: tv.venue?.business_days ?? null,
    business_hours: tv.venue?.business_hours ?? null,
  }
  const todayLocal = localDate(new Date())
  const monthLocalPrefix = todayLocal.slice(0, 7)
  const todayStr = new Date().toISOString().slice(0, 10)
  const monthStart = todayStr.slice(0, 8) + '01'
  const [{ data: up }, { data: plays }] = await Promise.all([
    supabase.from('tv_uptime_days').select('seconds').eq('tv_id', id).eq('day', todayStr).maybeSingle(),
    supabase.from('ad_plays').select('ad_id, played_at').eq('tv_id', id).gte('played_at', monthStart),
  ])
  const uptimeToday = (up as { seconds: number } | null)?.seconds ?? 0
  const allPlayRows = (plays ?? []) as { ad_id: string; played_at: string }[]
  // Drop plays that happened while the venue was closed.
  const playRows = allPlayRows.filter((p) => isWithinOpenHours(p.played_at, venueHours))
  const byAd = new Map<string, { today: number; month: number }>()
  let playsTodayTotal = 0
  for (const p of playRows) {
    const ld = localDate(p.played_at)
    if (ld.slice(0, 7) !== monthLocalPrefix) continue
    const e = byAd.get(p.ad_id) ?? { today: 0, month: 0 }
    e.month += 1
    if (ld === todayLocal) {
      e.today += 1
      playsTodayTotal += 1
    }
    byAd.set(p.ad_id, e)
  }
  // Titles for any ad that has plays (may include ads no longer on the loop).
  const playAdIds = [...byAd.keys()]
  const adTitle = new Map<string, string>()
  for (const p of placements) if (p.ad) adTitle.set(p.ad.id, p.ad.title)
  const missingTitles = playAdIds.filter((aid) => !adTitle.has(aid))
  if (missingTitles.length) {
    const { data: titleRows } = await supabase.from('ads').select('id, title').in('id', missingTitles)
    for (const a of titleRows ?? []) adTitle.set(a.id, a.title)
  }
  const playList = playAdIds
    .map((aid) => ({ id: aid, title: adTitle.get(aid) ?? 'Ad', ...byAd.get(aid)! }))
    .sort((a, b) => b.month - a.month)

  return (
    <>
      <PageHeader
        title={tv.venue?.name ?? 'Screen'}
        description="Screen detail"
        action={
          <div className="flex gap-1">
            {tv.device_id && (
              <a
                // Preview must present the screen's device secret or /api/tv/loop
                // 403s and the player falls back to the pairing prompt. Read-only:
                // preview skips heartbeat + play logging, so it never disturbs the
                // live device. Omitted for legacy null-secret screens (grandfathered).
                href={`${kioskUrl(origin, tv.device_id)}&preview=1${
                  tv.device_secret ? `&secret=${encodeURIComponent(tv.device_secret)}` : ''
                }`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <MonitorPlay className="size-4" /> Watch screen
              </a>
            )}
            <RegenerateButton id={tv.id} />
            <DeleteButton id={tv.id} action={deleteTv} />
          </div>
        }
      />

      <div className="space-y-6 p-5 md:p-6">
        <AutoRefresh seconds={20} />
        <Link
          href="/admin/venues"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Venues & screens
        </Link>

        {/* Status + live metrics */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="mt-2">
                <LiveStatus
                  lastHeartbeat={tv.last_heartbeat_at}
                  paired={!!tv.device_id}
                  adsRunning={used}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Last seen {timeAgo(tv.last_heartbeat_at)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">On today</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {formatDuration(uptimeToday)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Ads shown today</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {formatNumber(playsTodayTotal)}
              </p>
              <p className="text-xs text-muted-foreground">during open hours</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Slot fill</p>
              <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
                {occ.used}/{occ.total}
              </p>
              <p className="text-xs text-muted-foreground">
                {occ.open} open · {used} paid + {houseSlides.length} house
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Setup: pairing code for a technician on-site, or the device link to
            re-image a replacement Pi for an already-paired screen. */}
        {(tv.device_id || tv.pairing_code) && (
          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="text-sm font-medium">Setup</p>
              {tv.device_id ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    This screen is paired. To re-image a replacement Pi for the same screen,
                    program this kiosk link onto it — no re-pairing needed.
                  </p>
                  <CopyField value={kioskUrl(origin, tv.device_id)} label="Copy screen link" />
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Give the technician this pairing code. On the Pi, open the player and enter it,
                    or set the kiosk URL to the setup link below to pair automatically.
                  </p>
                  <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-center">
                    <p className="font-heading text-2xl font-bold tracking-[0.25em] tabular-nums">
                      {tv.pairing_code}
                    </p>
                  </div>
                  {tv.pairing_code && (
                    <CopyField
                      value={pairingUrl(origin, tv.pairing_code)}
                      label="Copy setup link"
                    />
                  )}
                </>
              )}

              {provisioning &&
                (provisioning.network_type === 'ethernet' ? (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Network: Wired (Ethernet)
                    {provisioning.network_note ? ` · ${provisioning.network_note}` : ''}
                  </p>
                ) : (
                  (provisioning.wifi_ssid || provisioning.wifi_password) && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-xs font-medium text-muted-foreground">WiFi to program</p>
                      {provisioning.wifi_ssid && (
                        <CopyField
                          value={provisioning.wifi_ssid}
                          display={`SSID: ${provisioning.wifi_ssid}`}
                          label="Copy SSID"
                        />
                      )}
                      {provisioning.wifi_password && (
                        <CopyField
                          value={provisioning.wifi_password}
                          display="Password: ••••••••"
                          label="Copy password"
                        />
                      )}
                      {provisioning.network_note && (
                        <p className="text-xs text-muted-foreground">{provisioning.network_note}</p>
                      )}
                    </div>
                  )
                ))}
            </CardContent>
          </Card>
        )}

        {/* Loop capacity: how many paid ad slots this screen sells + slot timing.
            House slides play on top, so this governs only what advertisers can buy. */}
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <p className="text-sm font-medium">Loop capacity</p>
              <p className="text-xs text-muted-foreground">
                Set how many ad spots this screen sells and the slot length used to size the loop.
                The always-on house slides (Brew Loop, “Advertise here”, trivia) play on top and are
                counted in the loop below. The exact on-screen time for each ad is set per ad in the
                loop list further down.
              </p>
            </div>
            <LoopConfig
              id={tv.id}
              adSlots={maxSlots}
              slotSeconds={tv.slot_seconds}
              houseCount={houseSlides.length}
              houseSeconds={houseSeconds}
              paidSold={used}
            />
          </CardContent>
        </Card>

        {/* Display: overscan safe-margin for this specific TV. */}
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <p className="text-sm font-medium">Display</p>
              <p className="text-xs text-muted-foreground">
                If this TV zooms past its edges and cuts off the QR or the edges of an ad, raise
                the safe margin so nothing important reaches the edge. 0 = edge-to-edge (default).
                Tap <span className="font-medium text-foreground">Calibrate</span> on the screen
                itself to see the cutoff and find the right number.
              </p>
            </div>
            <OverscanControl id={tv.id} overscan={tv.overscan_pct ?? 0} />
          </CardContent>
        </Card>

        {/* Plays per ad */}
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <p className="text-sm font-medium">Times shown per ad</p>
              <p className="text-xs text-muted-foreground">
                Counted only while the venue is open ({formatOpenHours(venueHours) ?? 'set hours'}),
                so it reflects real impressions.
              </p>
            </div>
            {playList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No plays during open hours yet. Counts appear here as the screen runs the loop while
                you&apos;re open.
              </p>
            ) : (
              <div className="space-y-2">
                {playList.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                  >
                    <span className="min-w-0 truncate font-medium">{p.title}</span>
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                      <span className="font-medium text-foreground">{formatNumber(p.today)}</span> today
                      {' · '}
                      <span className="font-medium text-foreground">{formatNumber(p.month)}</span> this
                      month
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Device {tv.device_id ?? 'not paired'} · Last sync {formatDateTime(tv.last_sync_at)} ·
          Created {formatDateTime(tv.created_at)}
        </p>

        {/* Current loop */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                On this screen — {used + houseSlides.length} slide
                {used + houseSlides.length === 1 ? '' : 's'} in the loop
              </p>
              <p className="text-xs text-muted-foreground">
                {used} paid ad{used === 1 ? '' : 's'} ({used} of {maxSlots} paid slots) plus{' '}
                {houseSlides.length} house slide{houseSlides.length === 1 ? '' : 's'} that always
                play. Set each one&apos;s seconds below too; house slides can&apos;t be removed.
              </p>
            </div>
            {placements.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Each paid ad shows for its own seconds. Change one, or set them all at once:
                </p>
                <SetAllDurations tvId={tv.id} defaultSeconds={firstAdSeconds} />
              </div>
            )}
            <div className="divide-y divide-border">
              {placements.length === 0 && (
                <p className="pb-3 text-sm text-muted-foreground">
                  No paid ads yet — only the house slides below are playing. Add an approved ad
                  below, or it fills automatically when the placement engine runs.
                </p>
              )}
              {placements.map((p) => (
                <div key={p.id} className="flex items-center gap-4 py-3 first:pt-0">
                  <span className="w-12 shrink-0 text-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    paid
                  </span>
                  <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
                    {p.ad?.creative_url ? (
                      p.ad.creative_type === 'video' ? (
                        <video src={p.ad.creative_url} className="h-full w-full object-contain" muted />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.ad.creative_url} alt={p.ad.title} loading="lazy" decoding="async" className="h-full w-full object-contain" />
                      )
                    ) : (
                      <ImageOff className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.ad?.title ?? 'Untitled'}</p>
                    {p.ad?.owner_user_id ? (
                      <Link
                        href={`/admin/advertisers/${p.ad.owner_user_id}`}
                        className="truncate block text-sm text-primary hover:underline"
                      >
                        {ownerName.get(p.ad.owner_user_id) ?? 'View advertiser'}
                      </Link>
                    ) : (
                      <p className="truncate text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                  {p.ad?.creative_type === 'video' ? (
                    <span className="shrink-0 text-xs text-muted-foreground">plays full video</span>
                  ) : p.ad?.id ? (
                    <AdDurationField
                      key={`${p.ad.id}-${p.ad.duration_seconds}`}
                      tvId={tv.id}
                      adId={p.ad.id}
                      seconds={p.ad.duration_seconds ?? 15}
                    />
                  ) : null}
                  <RemovePlacementButton id={p.id} tvId={tv.id} />
                </div>
              ))}
              {houseSlides.map((h, i) => (
                <div key={`house-${i}`} className="flex items-center gap-4 py-3 first:pt-0">
                  <span className="w-12 shrink-0 text-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    house
                  </span>
                  <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                    house
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{h.label}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      Always plays · not a paid slot
                    </p>
                  </div>
                  <HouseDurationField
                    key={`${h.kind}-${h.seconds}`}
                    tvId={tv.id}
                    slideKind={h.kind}
                    seconds={h.seconds}
                  />
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium">Add an ad to this screen</p>
              <AddPlacement tvId={tv.id} ads={candidates} />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
