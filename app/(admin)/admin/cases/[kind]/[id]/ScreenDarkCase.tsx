import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatCents, timeAgo, formatDateTime } from '@/lib/format'
import {
  summarizeUptime,
  venueBusinessHours,
  formatBusinessHours,
  formatUptimePct,
  expectedSecondsForDate,
  UPTIME_SLA,
} from '@/lib/uptime'
import type { PerDayHours } from '@/lib/openHours'
import {
  CaseShell,
  CaseSection,
  Evidence,
  EvidenceGrid,
  CaseAction,
  CaseActions,
} from '@/components/admin/CaseShell'

// A screen that stopped checking in.
//
// The uptime page could always tell you a screen was down. It could not tell you
// what that costs, who is being short-changed by it, or when it actually stopped
// — which is everything you need to decide whether to drive out there today.

const DAY_MS = 86_400_000
const HISTORY_DAYS = 14

export async function ScreenDarkCase({ tvId }: { tvId: string }) {
  const supabase = await createClient()

  const { data: tvRow } = await supabase
    .from('tvs')
    .select(
      'id, device_id, last_heartbeat_at, last_sync_at, venue:venues(id, name, status, address, contact_name, contact_email, contact_phone, business_open, business_close, business_days, business_hours)'
    )
    .eq('id', tvId)
    .maybeSingle()
  if (!tvRow) notFound()

  type VenueRow = {
    id: string
    name: string
    status: string
    address: string | null
    contact_name: string | null
    contact_email: string | null
    contact_phone: string | null
    business_open: string | null
    business_close: string | null
    business_days: number[] | null
    business_hours: PerDayHours | null
  }
  const tv = tvRow as unknown as {
    id: string
    device_id: string | null
    last_heartbeat_at: string | null
    last_sync_at: string | null
    venue: VenueRow | VenueRow[] | null
  }
  const venue = (Array.isArray(tv.venue) ? tv.venue[0] : tv.venue) as VenueRow | null
  if (!venue) notFound()

  const sinceISO = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10)
  const [{ data: uptimeRows }, { data: placeRows }] = await Promise.all([
    supabase
      .from('tv_uptime_days')
      .select('day, seconds')
      .eq('tv_id', tvId)
      .gte('day', sinceISO)
      .order('day'),
    supabase
      .from('ad_placements')
      .select(
        'id, campaign_id, ad:ads(id, title), campaign:campaigns(id, monthly_total_cents, advertiser:profiles!advertiser_id(id, full_name, email, phone))'
      )
      .eq('tv_id', tvId)
      .eq('status', 'active'),
  ])

  const days = (uptimeRows ?? []) as { day: string; seconds: number }[]
  const bh = venueBusinessHours(venue)
  const summary = summarizeUptime(days, bh, 30)

  type PlaceRow = {
    id: string
    campaign_id: string | null
    ad: { id: string; title: string } | { id: string; title: string }[] | null
    campaign:
      | {
          id: string
          monthly_total_cents: number | null
          advertiser:
            | { id: string; full_name: string | null; email: string; phone: string | null }
            | { id: string; full_name: string | null; email: string; phone: string | null }[]
            | null
        }
      | {
          id: string
          monthly_total_cents: number | null
          advertiser:
            | { id: string; full_name: string | null; email: string; phone: string | null }
            | { id: string; full_name: string | null; email: string; phone: string | null }[]
            | null
        }[]
      | null
  }
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  // How much of each campaign's money rides on THIS screen: its monthly rate
  // split across every screen it currently sits on. A campaign on five screens
  // loses a fifth of its delivery when one goes dark, not all of it.
  const placements = ((placeRows ?? []) as unknown as PlaceRow[]).map((p) => ({
    adTitle: one(p.ad)?.title ?? 'Ad',
    adId: one(p.ad)?.id ?? null,
    campaignId: p.campaign_id,
    monthly: one(p.campaign)?.monthly_total_cents ?? 0,
    advertiser: one(one(p.campaign)?.advertiser ?? null),
  }))
  const campaignIds = placements.map((p) => p.campaignId).filter((x): x is string => !!x)
  const screensPerCampaign = new Map<string, number>()
  if (campaignIds.length) {
    const { data: spread } = await supabase
      .from('ad_placements')
      .select('campaign_id')
      .eq('status', 'active')
      .in('campaign_id', campaignIds)
    for (const r of (spread ?? []) as { campaign_id: string | null }[]) {
      if (!r.campaign_id) continue
      screensPerCampaign.set(r.campaign_id, (screensPerCampaign.get(r.campaign_id) ?? 0) + 1)
    }
  }
  const affected = placements.map((p) => ({
    ...p,
    share: p.campaignId
      ? Math.round(p.monthly / Math.max(1, screensPerCampaign.get(p.campaignId) ?? 1))
      : 0,
  }))
  const atRisk = affected.reduce((s, a) => s + a.share, 0)

  // Last day with any recorded uptime — the honest answer to "when did it stop",
  // which the heartbeat alone rounds off once it has been dark a while.
  const lastGoodDay = [...days].reverse().find((d) => d.seconds > 0)?.day ?? null
  const darkFor = tv.last_heartbeat_at
    ? Math.floor((Date.now() - new Date(tv.last_heartbeat_at).getTime()) / DAY_MS)
    : null

  // Last 14 days as a strip: measured against what that day should have been.
  const byDay = new Map(days.map((d) => [d.day, d.seconds]))
  const strip: { day: string; pct: number; expected: number }[] = []
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS)
    const key = d.toISOString().slice(0, 10)
    const expected = expectedSecondsForDate(bh, d)
    strip.push({
      day: key,
      expected,
      pct: expected > 0 ? Math.min(1, (byDay.get(key) ?? 0) / expected) : 0,
    })
  }

  return (
    <CaseShell
      severity="critical"
      title={venue.name}
      verdict={
        affected.length
          ? `This screen has not checked in ${tv.last_heartbeat_at ? `since ${timeAgo(tv.last_heartbeat_at)}` : 'at all'}. ${affected.length} paying ad${affected.length === 1 ? ' is' : 's are'} assigned to it and ${affected.length === 1 ? 'it is' : 'they are'} not being shown.`
          : `This screen has not checked in ${tv.last_heartbeat_at ? `since ${timeAgo(tv.last_heartbeat_at)}` : 'at all'}. Nothing is sold on it yet, so no advertiser is affected — but it cannot be sold while it is dark.`
      }
      moneyCents={atRisk}
      moneyNote="per month riding on this screen"
    >
      <EvidenceGrid>
        <Evidence
          label="Last seen"
          value={tv.last_heartbeat_at ? timeAgo(tv.last_heartbeat_at) : 'Never'}
          note={tv.last_heartbeat_at ? formatDateTime(tv.last_heartbeat_at) : 'never paired in'}
          tone="bad"
        />
        <Evidence
          label="Dark for"
          value={darkFor == null ? '—' : `${darkFor} day${darkFor === 1 ? '' : 's'}`}
          note={lastGoodDay ? `last full day ${lastGoodDay}` : 'no uptime on record'}
          tone={darkFor != null && darkFor >= 2 ? 'bad' : 'warn'}
        />
        <Evidence
          label="Uptime 30d"
          value={summary.hasData ? formatUptimePct(summary.pct) : '—'}
          note={`${Math.round(UPTIME_SLA * 100)}% is the bar`}
          tone={summary.breach ? 'bad' : 'good'}
        />
        <Evidence
          label="Ads assigned"
          value={String(affected.length)}
          note={atRisk ? `${formatCents(atRisk)}/mo of delivery` : 'nothing sold here'}
          tone={affected.length ? 'warn' : undefined}
        />
      </EvidenceGrid>

      <CaseSection title="When it stopped" note={`open hours: ${formatBusinessHours(bh)}`}>
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-end gap-1">
            {strip.map((s) => (
              <div key={s.day} className="flex-1" title={`${s.day} · ${Math.round(s.pct * 100)}%`}>
                <div className="flex h-16 items-end">
                  <div
                    className={
                      'w-full rounded-sm ' +
                      (s.expected === 0
                        ? 'bg-muted'
                        : s.pct >= UPTIME_SLA
                          ? 'bg-success'
                          : s.pct > 0
                            ? 'bg-warning'
                            : 'bg-destructive/30')
                    }
                    style={{ height: `${Math.max(s.expected === 0 ? 4 : 6, s.pct * 100)}%` }}
                  />
                </div>
                <div className="mt-1 text-center text-[9px] text-muted-foreground">
                  {s.day.slice(8)}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each bar is one day, measured against the hours this venue is open. Grey days are days
            the venue is closed — a screen is not expected to run then.
          </p>
        </div>
      </CaseSection>

      {affected.length > 0 && (
        <CaseSection title="Who is affected" note="money split across the screens each ad runs on">
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {affected.map((a, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {a.advertiser?.full_name ?? a.advertiser?.email ?? 'Unknown advertiser'}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.adTitle}
                    {a.campaignId && screensPerCampaign.get(a.campaignId)
                      ? ` · on ${screensPerCampaign.get(a.campaignId)} screen${screensPerCampaign.get(a.campaignId) === 1 ? '' : 's'}`
                      : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm tabular-nums text-destructive">
                    {formatCents(a.share)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">not delivering</div>
                </div>
              </div>
            ))}
          </div>
        </CaseSection>
      )}

      <CaseSection title="What to do">
        <CaseActions>
          <CaseAction
            href={`/admin/tvs/${tv.id}`}
            label="Open the screen"
            detail="Pairing code, loop contents, and the reboot checklist for this device."
          />
          {venue.contact_phone && (
            <CaseAction
              href={`tel:${venue.contact_phone}`}
              external
              label={`Call ${venue.contact_name ?? venue.name}`}
              detail={`${venue.contact_phone} — ask them to check the TV input and that the stick has power.`}
            />
          )}
          {venue.contact_email && (
            <CaseAction
              href={`mailto:${venue.contact_email}`}
              external
              label="Email the host"
              detail={venue.contact_email}
            />
          )}
          <CaseAction
            href={`/admin/venues/${venue.id}`}
            label="Open the venue"
            detail="Hours, other screens here, and the host's agreement."
          />
          <CaseAction
            href="/admin/uptime"
            label="Compare every screen"
            detail="See whether this is one device or the whole venue's internet."
          />
        </CaseActions>
      </CaseSection>
    </CaseShell>
  )
}
