// Monthly ROI report builder. Turns a campaign's prior-month activity into a
// data object and an HTML email body, reusing the same analytics helpers the
// advertiser campaign page uses so the numbers match what they see in-app.
//
// Two number kinds, kept honest the same way the UI does it:
//   • Times shown            — MEASURED proof-of-play, open-hours filtered.
//   • QR scans               — MEASURED scan events (bots excluded), scoped to the month.
//   • Estimated reach        — from each running venue's monthly foot_traffic_estimate.
//
// Server-only (uses the service-role admin client). Email copy avoids dashes on
// purpose (Jacob's outreach rule).

import { createAdminClient } from '@/lib/supabase/admin'
import {
  estImpressionsPerMonth,
  locationRows,
  measuredPlaysTotal,
  type RunningVenue,
  type ScanRow,
  type LocationRow,
} from '@/lib/analytics'
import { isWithinOpenHours } from '@/lib/openHours'
import { formatNumber } from '@/lib/format'
import { hasInsightsMembership } from '@/lib/membership'

type Admin = ReturnType<typeof createAdminClient>

export type ReportPeriod = {
  month: string // 'YYYY-MM'
  startISO: string // inclusive
  endISO: string // exclusive (first instant of next month)
  label: string // e.g. 'May 2026'
}

// The 'YYYY-MM' for the calendar month before `ref` (defaults to now).
export function priorMonth(ref = new Date()): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1))
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 7)
}

export function periodForMonth(month: string): ReportPeriod {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  const label = start.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return {
    month,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    label,
  }
}

export type VenueTypeRow = { type: string; plays: number; scans: number }

export type CampaignReport = {
  campaignId: string
  advertiserEmail: string | null
  advertiserName: string | null
  adTitle: string
  period: ReportPeriod
  estImpressions: number
  totalPlays: number // measured times shown (proof-of-play, open-hours filtered)
  totalScans: number
  scansPer1000: number | null // scans per 1,000 times shown (null when no plays)
  byVenueType: VenueTypeRow[]
  exclusiveCount: number // venues this campaign owns its category at
  creditCents: number // SLA uptime credits issued this period
  showScans: boolean // advertiser holds the Insights membership (QR scans unlocked)
  locationsCount: number
  locations: LocationRow[]
  monthlyTotalCents: number | null
}

// Assemble the report for one campaign and period. Returns null if the campaign
// is gone. Screens come from the month's placement snapshot (every screen the ad
// ran on that month), falling back to currently-active placements if none exists.
export async function buildCampaignReport(
  admin: Admin,
  campaignId: string,
  period: ReportPeriod
): Promise<CampaignReport | null> {
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, advertiser_id, ad_id, monthly_total_cents')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return null

  const [{ data: profile }, { data: ad }] = await Promise.all([
    campaign.advertiser_id
      ? admin
          .from('profiles')
          .select('email, full_name')
          .eq('id', campaign.advertiser_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    campaign.ad_id
      ? admin.from('ads').select('title').eq('id', campaign.ad_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Screens the ad ran on THAT month. Prefer the month's placement snapshot (every
  // screen active on any day, written daily by the place cron); fall back to
  // currently-active placements for a campaign with no snapshot yet.
  const { data: snapRows } = await admin
    .from('placement_snapshots')
    .select('tv_id')
    .eq('campaign_id', campaignId)
    .eq('period_month', period.month)
  let tvIds = [...new Set(((snapRows ?? []) as { tv_id: string }[]).map((s) => s.tv_id))]
  if (!tvIds.length) {
    const { data: activePl } = await admin
      .from('ad_placements')
      .select('tv_id')
      .eq('campaign_id', campaignId)
      .eq('status', 'active')
    tvIds = [...new Set(((activePl ?? []) as { tv_id: string }[]).map((p) => p.tv_id))]
  }

  // Resolve each screen's venue (name/geo/type/hours), building distinct venues.
  const venueMap = new Map<string, RunningVenue>()
  const tvToVenueId = new Map<string, string>()
  const tvOpenHours = new Map<
    string,
    {
      business_open: string | null
      business_close: string | null
      business_days: number[] | null
      business_hours: Record<string, { open: string; close: string }> | null
    }
  >()
  if (tvIds.length) {
    const { data: tvData } = await admin
      .from('tvs')
      .select(
        'id, venue:venues(id, name, lat, lng, foot_traffic_estimate, median_daily_customers, venue_type, business_open, business_close, business_days, business_hours)'
      )
      .in('id', tvIds)
    type TvRow = {
      id: string
      venue: {
        id: string
        name: string
        lat: number | null
        lng: number | null
        foot_traffic_estimate: number
        median_daily_customers: number | null
        venue_type: string | null
        business_open: string | null
        business_close: string | null
        business_days: number[] | null
        business_hours: Record<string, { open: string; close: string }> | null
      } | null
    }
    for (const t of (tvData ?? []) as unknown as TvRow[]) {
      const v = t.venue
      if (!v) continue
      tvToVenueId.set(t.id, v.id)
      tvOpenHours.set(t.id, {
        business_open: v.business_open,
        business_close: v.business_close,
        business_days: v.business_days,
        business_hours: v.business_hours,
      })
      const existing = venueMap.get(v.id)
      if (existing) existing.tvIds.push(t.id)
      else
        venueMap.set(v.id, {
          venueId: v.id,
          name: v.name,
          lat: v.lat,
          lng: v.lng,
          footTraffic: v.foot_traffic_estimate ?? 0,
          medianDailyCustomers: v.median_daily_customers ?? null,
          tvIds: [t.id],
          plays: 0,
          venueType: v.venue_type,
        })
    }
  }
  const venues = [...venueMap.values()]
  // Distinct SCREENS (TVs), not venues — the email says "Running on N screens",
  // and a venue can hold several. tv ids are globally unique, so summing is safe.
  const screenCount = venues.reduce((s, v) => s + v.tvIds.length, 0)

  // Measured QR scans scoped to the report month (attributed to a screen + day).
  // Bots excluded so the "a real person scanned this" copy stays true.
  let scans: ScanRow[] = []
  if (campaign.ad_id) {
    const { data: scanData } = await admin
      .from('qr_scans')
      .select('tv_id, scanned_at')
      .eq('ad_id', campaign.ad_id)
      .eq('is_bot', false)
      .gte('scanned_at', period.startISO)
      .lt('scanned_at', period.endISO)
    scans = (scanData ?? []) as ScanRow[]
  }

  // Measured times shown (proof-of-play), open-hours filtered per screen, scoped to
  // the month, attributed back to the venue.
  if (campaign.ad_id && tvIds.length) {
    const { data: playData } = await admin
      .from('ad_plays')
      .select('tv_id, played_at')
      .eq('ad_id', campaign.ad_id)
      .in('tv_id', tvIds)
      .gte('played_at', period.startISO)
      .lt('played_at', period.endISO)
    const playsByVenue = new Map<string, number>()
    for (const p of (playData ?? []) as { tv_id: string; played_at: string }[]) {
      const hours = tvOpenHours.get(p.tv_id)
      if (hours && !isWithinOpenHours(p.played_at, hours)) continue
      const vid = tvToVenueId.get(p.tv_id)
      if (!vid) continue
      playsByVenue.set(vid, (playsByVenue.get(vid) ?? 0) + 1)
    }
    for (const v of venues) v.plays = playsByVenue.get(v.venueId) ?? 0
  }

  const locations = locationRows(venues, scans)
  const totalPlays = measuredPlaysTotal(venues)
  // The rate uses scans ATTRIBUTED to the counted screens (same scope as plays) so
  // the per-1,000 figure reconciles with the per-location rows. totalScans (the
  // headline) stays the full count, including scans with no screen tag.
  const attributedScans = locations.reduce((s, l) => s + l.scans, 0)
  const scansPer1000 = totalPlays > 0 ? Math.round((attributedScans / totalPlays) * 1000) : null

  // Venue-type mix (plays + scans by the venue's type label).
  const scanVenueByType = new Map<string, string>() // tvId -> venueType, for scan attribution
  for (const v of venues) for (const t of v.tvIds) scanVenueByType.set(t, v.venueType ?? 'Other')
  const typeMap = new Map<string, VenueTypeRow>()
  for (const v of venues) {
    const key = v.venueType ?? 'Other'
    const row = typeMap.get(key) ?? { type: key, plays: 0, scans: 0 }
    row.plays += v.plays ?? 0
    typeMap.set(key, row)
  }
  for (const s of scans) {
    if (!s.tv_id) continue
    const key = scanVenueByType.get(s.tv_id)
    if (!key) continue
    const row = typeMap.get(key) ?? { type: key, plays: 0, scans: 0 }
    row.scans += 1
    typeMap.set(key, row)
  }
  const byVenueType = [...typeMap.values()].sort((a, b) => b.plays - a.plays || b.scans - a.scans)

  // Exclusivity + SLA credits for the period.
  const { count: exclusiveCount } = await admin
    .from('exclusive_slots')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'active')
  const { data: creditRows } = await admin
    .from('credits')
    .select('amount_cents')
    .eq('campaign_id', campaignId)
    .eq('period_month', period.month)
  const creditCents = ((creditRows ?? []) as { amount_cents: number }[]).reduce(
    (s, c) => s + (c.amount_cents ?? 0),
    0
  )

  // QR scan numbers only go to advertisers on the Insights membership (coming
  // soon); everyone else gets a scans-free report.
  const showScans = campaign.advertiser_id
    ? await hasInsightsMembership(admin, campaign.advertiser_id)
    : false

  return {
    campaignId,
    advertiserEmail: profile?.email ?? null,
    advertiserName: profile?.full_name ?? null,
    adTitle: ad?.title ?? 'Your campaign',
    period,
    estImpressions: estImpressionsPerMonth(venues),
    totalPlays,
    totalScans: scans.length,
    scansPer1000,
    byVenueType,
    exclusiveCount: exclusiveCount ?? 0,
    creditCents,
    showScans,
    locationsCount: screenCount,
    locations,
    monthlyTotalCents: campaign.monthly_total_cents ?? null,
  }
}

export function reportSubject(r: CampaignReport): string {
  return `Your Loop Network report for ${r.period.label}`
}

// Inline-styled HTML so it renders across email clients. No dashes in copy.
export function renderReportHtml(r: CampaignReport, appUrl: string): string {
  const greeting = r.advertiserName ? `Hi ${escapeHtml(r.advertiserName.split(' ')[0])},` : 'Hi,'
  const campaignUrl = `${appUrl.replace(/\/$/, '')}/advertiser/campaigns/${r.campaignId}`

  const rowsHtml =
    r.locations.length === 0
      ? `<tr><td style="padding:12px 0;color:#71717a;font-size:14px;">Your ad is being matched to screens. Location detail will appear in next month's report.</td></tr>`
      : r.locations
          .map(
            (loc: LocationRow) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #27272a;">
            <div style="font-weight:600;color:#fafafa;font-size:14px;">${escapeHtml(loc.name)}</div>
            <div style="margin-top:4px;color:#a1a1aa;font-size:12px;">
              ${formatNumber(loc.plays)} times shown${r.showScans ? ` &middot; ${formatNumber(loc.scans)} QR scans` : ''}
            </div>
          </td>
        </tr>`
          )
          .join('')

  // Venue-type mix (only when there's more than one type and something to show).
  const typeHtml =
    r.byVenueType.length > 1 && r.totalPlays + r.totalScans > 0
      ? `
            <div style="margin-top:24px;color:#fafafa;font-size:14px;font-weight:600;">Where it landed</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
              ${r.byVenueType
                .map(
                  (t) => `<tr><td style="padding:8px 0;border-top:1px solid #27272a;color:#d4d4d8;font-size:13px;">
                    ${escapeHtml(t.type)}
                    <span style="color:#71717a;">&middot; ${formatNumber(t.plays)} shown${r.showScans ? ` &middot; ${formatNumber(t.scans)} scans` : ''}</span>
                  </td></tr>`
                )
                .join('')}
            </table>`
      : ''

  // Exclusivity line, only when it applies.
  const extraLines: string[] = []
  if (r.exclusiveCount > 0) {
    extraLines.push(
      `You own your category exclusively at ${r.exclusiveCount} venue${r.exclusiveCount === 1 ? '' : 's'} this month.`
    )
  }
  if (!r.showScans) {
    extraLines.push('QR scan analytics are coming soon with Loop Insights.')
  }
  const extraHtml = extraLines.length
    ? `<div style="margin-top:20px;padding:12px 14px;background:#111113;border:1px solid #27272a;border-radius:10px;color:#d4d4d8;font-size:13px;line-height:1.5;">${extraLines
        .map((l) => escapeHtml(l))
        .join('<br/>')}</div>`
    : ''

  const scanRate =
    r.showScans && r.scansPer1000 != null
      ? `<div style="margin-top:10px;color:#71717a;font-size:12px;">${formatNumber(r.scansPer1000)} scans per 1,000 times shown</div>`
      : ''

  return `<!doctype html>
<html>
<body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0a0a0b;border:1px solid #27272a;border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:24px 28px;border-bottom:1px solid #27272a;">
            <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#d4a333;font-weight:700;">Loop Network</div>
            <div style="margin-top:6px;color:#fafafa;font-size:20px;font-weight:700;">${escapeHtml(r.adTitle)}</div>
            <div style="margin-top:2px;color:#a1a1aa;font-size:13px;">${escapeHtml(r.period.label)} performance</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px;">
            <p style="margin:0 0 18px;color:#d4d4d8;font-size:14px;line-height:1.5;">${greeting}<br/>Here is how your ad performed last month across the network.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="${r.showScans ? '50%' : '100%'}" style="padding:14px;background:#111113;border:1px solid #27272a;border-radius:10px;">
                  <div style="color:#71717a;font-size:12px;">Times shown</div>
                  <div style="margin-top:4px;color:#fafafa;font-size:24px;font-weight:700;">${formatNumber(r.totalPlays)}</div>
                </td>
                ${
                  r.showScans
                    ? `<td width="12"></td>
                <td width="50%" style="padding:14px;background:#111113;border:1px solid #27272a;border-radius:10px;">
                  <div style="color:#71717a;font-size:12px;">QR scans</div>
                  <div style="margin-top:4px;color:#fafafa;font-size:24px;font-weight:700;">${formatNumber(r.totalScans)}</div>
                </td>`
                    : ''
                }
              </tr>
            </table>
            ${scanRate}

            <div style="margin-top:18px;color:#fafafa;font-size:14px;font-weight:600;">
              Running on ${r.locationsCount} screen${r.locationsCount === 1 ? '' : 's'}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
              ${rowsHtml}
            </table>
            ${typeHtml}
            ${extraHtml}

            <div style="margin-top:24px;">
              <a href="${campaignUrl}" style="display:inline-block;background:#d4a333;color:#0a0a0b;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:9px;">View full dashboard</a>
            </div>

            <p style="margin:22px 0 0;color:#52525b;font-size:11px;line-height:1.5;">
              ${
                r.showScans
                  ? 'Times shown and QR scans are measured on the screens themselves, counted only during each venue&apos;s open hours.'
                  : 'Times shown is measured on the screens themselves, counted only during each venue&apos;s open hours.'
              } Numbers reflect the screens your ad ran on this month.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
