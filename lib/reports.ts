// Monthly ROI report builder. Turns a campaign's prior-month activity into a
// data object and an HTML email body, reusing the same analytics helpers the
// advertiser campaign page uses so the numbers match what they see in-app.
//
// Two number kinds, kept honest the same way the UI does it:
//   • Estimated impressions  — from each running venue's monthly foot_traffic_estimate.
//   • QR scans               — MEASURED scan events, scoped to the report month.
//
// Server-only (uses the service-role admin client). Email copy avoids dashes on
// purpose (Jacob's outreach rule).

import { createAdminClient } from '@/lib/supabase/admin'
import {
  estImpressionsPerMonth,
  locationRows,
  type RunningVenue,
  type ScanRow,
  type LocationRow,
} from '@/lib/analytics'
import { formatNumber, formatCents } from '@/lib/format'

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

export type CampaignReport = {
  campaignId: string
  advertiserEmail: string | null
  advertiserName: string | null
  adTitle: string
  period: ReportPeriod
  estImpressions: number
  totalScans: number
  locationsCount: number
  locations: LocationRow[]
  monthlyTotalCents: number | null
}

// Assemble the report for one campaign and period. Returns null if the campaign
// is gone. Venues are the campaign's currently-running screens (a fair proxy for
// where it ran; historical placement snapshots are a later phase).
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

  // Distinct running venues + their screens (one venue can host several TVs).
  const { data: placementsData } = await admin
    .from('ad_placements')
    .select('id, tv:tvs(id, venue:venues(id, name, lat, lng, foot_traffic_estimate))')
    .eq('campaign_id', campaignId)
    .neq('status', 'ended')
  type PRow = {
    id: string
    tv: {
      id: string
      venue: {
        id: string
        name: string
        lat: number | null
        lng: number | null
        foot_traffic_estimate: number
      } | null
    } | null
  }
  const placements = (placementsData ?? []) as unknown as PRow[]
  const venueMap = new Map<string, RunningVenue>()
  for (const p of placements) {
    const v = p.tv?.venue
    const tvId = p.tv?.id
    if (!v || !tvId) continue
    const existing = venueMap.get(v.id)
    if (existing) existing.tvIds.push(tvId)
    else
      venueMap.set(v.id, {
        venueId: v.id,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        footTraffic: v.foot_traffic_estimate ?? 0,
        tvIds: [tvId],
      })
  }
  const venues = [...venueMap.values()]

  // Measured QR scans scoped to the report month (attributed to a screen + day).
  let scans: ScanRow[] = []
  if (campaign.ad_id) {
    const { data: scanData } = await admin
      .from('qr_scans')
      .select('tv_id, scanned_at')
      .eq('ad_id', campaign.ad_id)
      .gte('scanned_at', period.startISO)
      .lt('scanned_at', period.endISO)
    scans = (scanData ?? []) as ScanRow[]
  }

  const locations = locationRows(venues, scans)

  return {
    campaignId,
    advertiserEmail: profile?.email ?? null,
    advertiserName: profile?.full_name ?? null,
    adTitle: ad?.title ?? 'Your campaign',
    period,
    estImpressions: estImpressionsPerMonth(venues),
    totalScans: scans.length,
    locationsCount: venues.length,
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
              ~${formatNumber(loc.estPerMonth)} estimated views &nbsp;&middot;&nbsp; ${formatNumber(loc.scans)} QR scans
            </div>
          </td>
        </tr>`
          )
          .join('')

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
                <td width="50%" style="padding:14px;background:#111113;border:1px solid #27272a;border-radius:10px;">
                  <div style="color:#71717a;font-size:12px;">Estimated views</div>
                  <div style="margin-top:4px;color:#fafafa;font-size:24px;font-weight:700;">${formatNumber(r.estImpressions)}</div>
                </td>
                <td style="width:12px;"></td>
                <td width="50%" style="padding:14px;background:#111113;border:1px solid #27272a;border-radius:10px;">
                  <div style="color:#71717a;font-size:12px;">QR scans</div>
                  <div style="margin-top:4px;color:#fafafa;font-size:24px;font-weight:700;">${formatNumber(r.totalScans)}</div>
                </td>
              </tr>
            </table>

            <div style="margin-top:18px;color:#fafafa;font-size:14px;font-weight:600;">
              Running on ${r.locationsCount} screen${r.locationsCount === 1 ? '' : 's'}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
              ${rowsHtml}
            </table>

            <div style="margin-top:24px;">
              <a href="${campaignUrl}" style="display:inline-block;background:#d4a333;color:#0a0a0b;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:9px;">View full dashboard</a>
            </div>

            <p style="margin:22px 0 0;color:#52525b;font-size:11px;line-height:1.5;">
              Estimated views are a projection from each venue's monthly foot traffic. QR scans are measured. Numbers reflect the screens your ad is currently running on.
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
