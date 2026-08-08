import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatCents, formatNumber, timeAgo } from '@/lib/format'
import { summarizeUptime, venueBusinessHours, formatUptimePct, screenDownState } from '@/lib/uptime'
import type { PerDayHours } from '@/lib/openHours'
import { loadAdResults, networkScanRate } from '@/lib/cases'
import {
  CaseShell,
  CaseSection,
  Evidence,
  EvidenceGrid,
  CaseAction,
  CaseActions,
} from '@/components/admin/CaseShell'

// An advertiser who is paying and not getting what they paid for.
//
// Two different failures wear the same face — "my ad isn't working" — and the
// fix for one is the opposite of the fix for the other:
//
//   not-airing   the screens they bought are dark. Nothing about their creative
//                is the problem. Fix the screen, then apologise, then credit.
//   no-response  it aired plenty and nobody scanned. The delivery is fine; the
//                offer or the creative is not.
//
// So this page always establishes delivery FIRST, and only then talks about
// response. Plays and scans are measured; reach is an estimate and says so.

const DAY_MS = 86_400_000
const WINDOW_DAYS = 30

export async function AdvertiserCase({
  campaignId,
  kind,
}: {
  campaignId: string
  kind: 'under-delivery' | 'no-results'
}) {
  const supabase = await createClient()
  const sinceISO = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString()

  const { data: campRow } = await supabase
    .from('campaigns')
    .select(
      'id, territory_id, monthly_total_cents, status, created_at, ad:ads(id, title, created_at, updated_at, creative_url, creative_type, qr_target_url), advertiser:profiles!advertiser_id(id, full_name, email, phone)'
    )
    .eq('id', campaignId)
    .maybeSingle()
  if (!campRow) notFound()

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  type Camp = {
    id: string
    territory_id: string
    monthly_total_cents: number | null
    status: string
    created_at: string
    ad:
      | {
          id: string
          title: string
          created_at: string
          updated_at: string
          creative_url: string | null
          creative_type: string
          qr_target_url: string | null
        }
      | null
    advertiser: { id: string; full_name: string | null; email: string; phone: string | null } | null
  }
  const raw = campRow as unknown as Record<string, unknown>
  const camp: Camp = {
    id: raw.id as string,
    territory_id: raw.territory_id as string,
    monthly_total_cents: raw.monthly_total_cents as number | null,
    status: raw.status as string,
    created_at: raw.created_at as string,
    ad: one(raw.ad as Camp['ad'] | Camp['ad'][]),
    advertiser: one(raw.advertiser as Camp['advertiser'] | Camp['advertiser'][]),
  }
  if (!camp.ad) notFound()

  const adId = camp.ad.id
  const advertiserName = camp.advertiser?.full_name ?? camp.advertiser?.email ?? 'This advertiser'

  // Where it is running, and whether those screens are alive.
  const { data: placeRows } = await supabase
    .from('ad_placements')
    .select(
      'tv:tvs(id, last_heartbeat_at, venue:venues(id, name, foot_traffic_estimate, median_daily_customers, business_open, business_close, business_days, business_hours))'
    )
    .eq('campaign_id', campaignId)
    .eq('status', 'active')

  type VenueRow = {
    id: string
    name: string
    foot_traffic_estimate: number | null
    median_daily_customers: number | null
    business_open: string | null
    business_close: string | null
    business_days: number[] | null
    business_hours: PerDayHours | null
  }
  type TvRow = { id: string; last_heartbeat_at: string | null; venue: VenueRow | VenueRow[] | null }

  const tvs = ((placeRows ?? []) as unknown as { tv: TvRow | TvRow[] | null }[])
    .map((p) => one(p.tv))
    .filter((t): t is TvRow => !!t)
    .map((t) => ({ ...t, venue: one(t.venue) }))
    .filter((t): t is TvRow & { venue: VenueRow } => !!t.venue)

  const tvIds = tvs.map((t) => t.id)

  // Measured: plays per screen (counted, never fetched — ad_plays is huge) and
  // scans (small enough to bucket in memory).
  const [playCounts, { data: scanRows }, { data: uptimeRows }] = await Promise.all([
    Promise.all(
      tvIds.map(async (tvId) => {
        const { count } = await createAdminClient()
          .from('ad_plays')
          .select('*', { count: 'exact', head: true })
          .eq('ad_id', adId)
          .eq('tv_id', tvId)
          .gte('played_at', sinceISO)
        return count ?? 0
      })
    ),
    createAdminClient()
      .from('qr_scans')
      .select('tv_id, scanned_at')
      .eq('ad_id', adId)
      .eq('is_bot', false)
      .gte('scanned_at', sinceISO),
    tvIds.length
      ? supabase
          .from('tv_uptime_days')
          .select('tv_id, day, seconds')
          .in('tv_id', tvIds)
          .gte('day', sinceISO.slice(0, 10))
      : Promise.resolve({ data: [] as { tv_id: string; day: string; seconds: number }[] }),
  ])

  const playsByTv = new Map(tvIds.map((id, i) => [id, playCounts[i]]))
  const scans = (scanRows ?? []) as { tv_id: string | null; scanned_at: string }[]
  const uptime = (uptimeRows ?? []) as { tv_id: string; day: string; seconds: number }[]

  const scansByTv = new Map<string, number>()
  const scansByDay = new Map<string, number>()
  for (const s of scans) {
    if (s.tv_id) scansByTv.set(s.tv_id, (scansByTv.get(s.tv_id) ?? 0) + 1)
    const k = s.scanned_at.slice(0, 10)
    scansByDay.set(k, (scansByDay.get(k) ?? 0) + 1)
  }

  // Roll screens up to the venues the advertiser actually bought.
  type VenueLine = {
    id: string
    name: string
    screens: number
    darkScreens: number
    plays: number
    scans: number
    estReach: number
    uptimePct: number | null
  }
  const venueMap = new Map<string, VenueLine>()
  for (const tv of tvs) {
    const v = tv.venue
    const line = venueMap.get(v.id) ?? {
      id: v.id,
      name: v.name,
      screens: 0,
      darkScreens: 0,
      plays: 0,
      scans: 0,
      // ESTIMATE — a venue's monthly reach, counted once per venue no matter how
      // many screens are in it (two TVs in one bar are not two crowds).
      estReach:
        v.median_daily_customers && v.median_daily_customers > 0
          ? v.median_daily_customers * 30
          : (v.foot_traffic_estimate ?? 0),
      uptimePct: null,
    }
    line.screens++
    if (screenDownState(tv.last_heartbeat_at, v).down) line.darkScreens++
    line.plays += playsByTv.get(tv.id) ?? 0
    line.scans += scansByTv.get(tv.id) ?? 0
    const rows = uptime.filter((u) => u.tv_id === tv.id).map((u) => ({ day: u.day, seconds: u.seconds }))
    const s = summarizeUptime(rows, venueBusinessHours(v), WINDOW_DAYS)
    line.uptimePct = line.uptimePct == null ? (s.hasData ? s.pct : null) : Math.min(line.uptimePct, s.hasData ? s.pct : 1)
    venueMap.set(v.id, line)
  }
  const venues = [...venueMap.values()].sort((a, b) => b.plays - a.plays)

  const totalPlays = [...playsByTv.values()].reduce((a, b) => a + b, 0)
  const totalScans = scans.length
  const attributedScans = venues.reduce((s, v) => s + v.scans, 0)
  const scanRate = totalPlays > 0 ? (attributedScans / totalPlays) * 1000 : null
  const estReach = venues.reduce((s, v) => s + v.estReach, 0)
  const darkScreens = venues.reduce((s, v) => s + v.darkScreens, 0)
  const monthly = camp.monthly_total_cents ?? 0

  // The bar they are measured against: the median of everyone else on the network.
  const allResults = await loadAdResults(camp.territory_id)
  const median = networkScanRate(allResults.filter((r) => r.campaignId !== campaignId))

  const creativeAgeDays = Math.floor(
    (Date.now() - new Date(camp.ad.updated_at || camp.ad.created_at).getTime()) / DAY_MS
  )

  // When the whole network is at ~zero scans, blaming one advertiser's creative
  // is dishonest: the QR is the only response signal we have, and at this volume
  // it is not measuring much. Say so, and point the fix at the right thing.
  const networkFlat = median == null || median < 0.5

  const verdict =
    kind === 'under-delivery'
      ? `${advertiserName} is paying ${formatCents(monthly)} a month for ${venues.reduce((s, v) => s + v.screens, 0)} screen${venues.reduce((s, v) => s + v.screens, 0) === 1 ? '' : 's'}, and ${darkScreens} of them ${darkScreens === 1 ? 'is' : 'are'} dark. This is our problem to fix before it is theirs.`
      : networkFlat
        ? `${advertiserName}'s ad has been shown ${formatNumber(totalPlays)} times in the last 30 days for ${totalScans === 0 ? 'no scans' : `${totalScans} scan${totalScans === 1 ? '' : 's'}`}. Every advertiser on the network is near zero, so this is not just their creative — the QR is the only response we measure, and at this volume it is barely measuring anything.`
        : totalScans === 0
          ? `${advertiserName}'s ad has been shown ${formatNumber(totalPlays)} times in the last 30 days and nobody has scanned it once. The screens are working — the ad is not giving anyone a reason to act.`
          : `${advertiserName} is getting ${scanRate!.toFixed(1)} scans per 1,000 plays against a network median of ${median!.toFixed(1)}. Delivery is fine; the creative or the offer is underperforming.`

  const daily: { day: string; scans: number }[] = []
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10)
    daily.push({ day: key, scans: scansByDay.get(key) ?? 0 })
  }
  const peakDay = Math.max(1, ...daily.map((d) => d.scans))

  return (
    <CaseShell
      severity={kind === 'under-delivery' ? 'critical' : 'warning'}
      title={advertiserName}
      verdict={verdict}
      moneyCents={monthly}
      moneyNote={kind === 'under-delivery' ? 'paid for delivery we owe' : 'at risk at renewal'}
    >
      <EvidenceGrid>
        <Evidence
          label="Times shown"
          value={formatNumber(totalPlays)}
          note="measured, last 30 days"
          tone={totalPlays === 0 ? 'bad' : undefined}
        />
        <Evidence
          label="Scans"
          value={formatNumber(totalScans)}
          note="measured, bots excluded"
          tone={totalScans === 0 ? 'bad' : undefined}
        />
        <Evidence
          label="Per 1,000 plays"
          value={scanRate == null ? '—' : scanRate.toFixed(1)}
          note={median == null ? 'no network median yet' : `network median ${median.toFixed(1)}`}
          tone={
            scanRate != null && median != null
              ? scanRate < median * 0.4
                ? 'bad'
                : scanRate >= median
                  ? 'good'
                  : 'warn'
              : undefined
          }
        />
        <Evidence
          label="Screens"
          value={`${venues.reduce((s, v) => s + v.screens, 0) - darkScreens}/${venues.reduce((s, v) => s + v.screens, 0)}`}
          note={darkScreens ? `${darkScreens} dark right now` : 'all checking in'}
          tone={darkScreens ? 'bad' : 'good'}
        />
      </EvidenceGrid>

      <CaseSection
        title="Where it ran"
        note="plays and scans are measured · reach is an estimate from venue traffic"
      >
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-md text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Venue</th>
                <th className="px-3 py-2 text-right font-medium">Shown</th>
                <th className="px-3 py-2 text-right font-medium">Scans</th>
                <th className="px-3 py-2 text-right font-medium">Uptime</th>
                <th className="px-3 py-2 text-right font-medium">Est. reach</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {venues.map((v) => (
                <tr key={v.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {v.screens} screen{v.screens === 1 ? '' : 's'}
                      {v.darkScreens > 0 && (
                        <span className="text-destructive"> · {v.darkScreens} dark</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(v.plays)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(v.scans)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {v.uptimePct == null ? '—' : formatUptimePct(v.uptimePct)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    ~{formatNumber(v.estReach)}
                  </td>
                </tr>
              ))}
              {venues.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    This campaign is not on any screen right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Estimated reach is people who walked past the screen, modelled from the venue&apos;s own
          traffic figure — not a measured view. Total across these venues: ~
          {formatNumber(estReach)} people a month.
        </p>
      </CaseSection>

      <CaseSection title="Scans, last 30 days" note={`${totalScans} total`}>
        <div className="rounded-lg border border-border p-3">
          <div className="flex h-20 items-end gap-px">
            {daily.map((d) => (
              <div
                key={d.day}
                className="flex-1"
                title={`${d.day} · ${d.scans} scan${d.scans === 1 ? '' : 's'}`}
              >
                <div
                  className={'w-full rounded-sm ' + (d.scans ? 'bg-primary' : 'bg-muted')}
                  style={{ height: `${d.scans ? Math.max(8, (d.scans / peakDay) * 80) : 3}px` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
            <span>{daily[0]?.day}</span>
            <span>{daily[daily.length - 1]?.day}</span>
          </div>
        </div>
      </CaseSection>

      <CaseSection title="What to do">
        <CaseActions>
          {kind === 'under-delivery' ? (
            <>
              <CaseAction
                href="/admin/uptime"
                label="Fix the dark screens first"
                detail={`${darkScreens} screen${darkScreens === 1 ? '' : 's'} on this campaign ${darkScreens === 1 ? 'is' : 'are'} not checking in. Nothing else matters until that is done.`}
              />
              <CaseAction
                href={`/admin/money?campaign=${camp.id}`}
                label="Credit the missed days"
                detail="They paid for delivery we did not make. Decide the credit before they ask for it."
              />
            </>
          ) : (
            <>
              {networkFlat && (
                <CaseAction
                  href="/admin/reports"
                  label="Give people a reason to scan before you judge the ad"
                  detail={`Across the whole network, ${formatNumber(totalPlays)}-play months are producing single-digit scans. A spot with no offer on it gets looked at and not acted on — that is a network-wide gap, not this advertiser's failure.`}
                />
              )}
              <CaseAction
                href="/admin/creative"
                label="Rebuild the creative"
                detail={`This one is ${creativeAgeDays} day${creativeAgeDays === 1 ? '' : 's'} old${camp.ad.qr_target_url ? '' : ' and has no scan destination at all'}. A dated spot with no offer is the usual cause of a flat scan line.`}
              />
              <CaseAction
                href={camp.advertiser?.id ? `/admin/advertisers/${camp.advertiser.id}` : '/admin/advertisers'}
                label="Look at what they are asking people to do"
                detail={
                  camp.ad.qr_target_url
                    ? `The QR goes to ${camp.ad.qr_target_url}. If that is a homepage rather than an offer, the scan has nowhere to land.`
                    : 'There is no scan destination on this ad, so the QR leads nowhere.'
                }
              />
            </>
          )}
          {camp.advertiser?.phone && (
            <CaseAction
              href={`tel:${camp.advertiser.phone}`}
              external
              label={`Call ${advertiserName}`}
              detail={`${camp.advertiser.phone} — tell them before renewal, not at it.`}
            />
          )}
          {camp.advertiser?.email && (
            <CaseAction
              href={`mailto:${camp.advertiser.email}`}
              external
              label="Email them the numbers"
              detail={`${camp.advertiser.email} — shown ${formatNumber(totalPlays)} times, ${totalScans} scan${totalScans === 1 ? '' : 's'}, and what we are changing.`}
            />
          )}
          <CaseAction
            href={camp.advertiser?.id ? `/admin/advertisers/${camp.advertiser.id}` : '/admin/advertisers'}
            label="Open the advertiser"
            detail={`Everything else they run with us · signed up ${timeAgo(camp.created_at)}`}
          />
        </CaseActions>
      </CaseSection>
    </CaseShell>
  )
}
