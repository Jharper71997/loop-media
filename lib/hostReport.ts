// Monthly HOST recap builder — the "here's what your screen did for you" email.
// The counterpart to lib/reports.ts (advertiser ROI report): it turns a host's
// prior-month screen activity into a data object + an HTML email body, reusing the
// same open-hours filter so "ads shown" matches what actually aired during the
// venue's hours.
//
// What a host gets, all measured:
//   • Ads shown        — proof-of-play on the host's screens, open-hours filtered.
//   • Local businesses — distinct paying advertisers who ran on the host's screens.
//   • Your own promos  — times the host's free self-promos played + their QR scans.
//   • Trivia players   — people who joined trivia at the host's venues that month.
//
// Server-only (service-role admin client). Email copy avoids dashes (Jacob's rule).

import { createAdminClient } from '@/lib/supabase/admin'
import { isWithinOpenHours } from '@/lib/openHours'
import { formatNumber } from '@/lib/format'
import type { ReportPeriod } from '@/lib/reports'

type Admin = ReturnType<typeof createAdminClient>

export type HostReport = {
  hostUserId: string
  hostEmail: string | null
  hostName: string | null
  period: ReportPeriod
  venuesCount: number
  screenCount: number
  adsShown: number // measured plays on the host's screens (open-hours filtered)
  advertiserCount: number // distinct paying advertisers who ran on the host's screens
  ownPromoPlays: number // times the host's own promos played
  ownPromoScans: number // QR scans on the host's own promos
  triviaPlayers: number // people who joined trivia at the host's venues this month
}

type OpenHours = {
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  business_hours: Record<string, { open: string; close: string }> | null
}

// Assemble the recap for one host + period. Returns null if the host has no active
// venue (the cron only feeds it hosts that do, but stay defensive).
export async function buildHostReport(
  admin: Admin,
  hostUserId: string,
  period: ReportPeriod
): Promise<HostReport | null> {
  const { data: profile } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', hostUserId)
    .maybeSingle()

  const { data: vRows } = await admin
    .from('venues')
    .select('id')
    .eq('host_user_id', hostUserId)
    .eq('status', 'active')
  const venueIds = [...new Set(((vRows ?? []) as { id: string }[]).map((v) => v.id))]
  if (!venueIds.length) return null

  // The host's screens + each screen's open hours (for the proof-of-play filter).
  const { data: tvRows } = await admin
    .from('tvs')
    .select('id, venue:venues(business_open, business_close, business_days, business_hours)')
    .in('venue_id', venueIds)
  type TvRow = { id: string; venue: OpenHours | null }
  const tvOpenHours = new Map<string, OpenHours>()
  const tvIds: string[] = []
  for (const t of (tvRows ?? []) as unknown as TvRow[]) {
    tvIds.push(t.id)
    tvOpenHours.set(t.id, {
      business_open: t.venue?.business_open ?? null,
      business_close: t.venue?.business_close ?? null,
      business_days: t.venue?.business_days ?? null,
      business_hours: t.venue?.business_hours ?? null,
    })
  }

  // The host's own-promo ads (their free self-advertising), all-time; scans/plays
  // below are scoped to the month.
  const { data: ownAds } = await admin
    .from('ads')
    .select('id')
    .eq('owner_user_id', hostUserId)
    .eq('owner_kind', 'host')
  const ownAdIds = new Set(((ownAds ?? []) as { id: string }[]).map((a) => a.id))

  // Every play on the host's screens this month, open-hours filtered.
  let adsShown = 0
  let ownPromoPlays = 0
  const playedAdIds = new Set<string>()
  if (tvIds.length) {
    const { data: plays } = await admin
      .from('ad_plays')
      .select('ad_id, tv_id, played_at')
      .in('tv_id', tvIds)
      .gte('played_at', period.startISO)
      .lt('played_at', period.endISO)
    for (const p of (plays ?? []) as { ad_id: string; tv_id: string; played_at: string }[]) {
      const hours = tvOpenHours.get(p.tv_id)
      if (hours && !isWithinOpenHours(p.played_at, hours)) continue
      adsShown++
      playedAdIds.add(p.ad_id)
      if (ownAdIds.has(p.ad_id)) ownPromoPlays++
    }
  }

  // How many distinct PAYING advertisers ran on the host's screens this month.
  let advertiserCount = 0
  if (playedAdIds.size) {
    const { data: adOwners } = await admin
      .from('ads')
      .select('owner_user_id, owner_kind')
      .in('id', [...playedAdIds])
    const advSet = new Set<string>()
    for (const a of (adOwners ?? []) as { owner_user_id: string; owner_kind: string }[]) {
      if (a.owner_kind === 'advertiser') advSet.add(a.owner_user_id)
    }
    advertiserCount = advSet.size
  }

  // QR scans on the host's own promos this month (bots excluded).
  let ownPromoScans = 0
  if (ownAdIds.size) {
    const { data: scanRows } = await admin
      .from('qr_scans')
      .select('id')
      .in('ad_id', [...ownAdIds])
      .eq('is_bot', false)
      .gte('scanned_at', period.startISO)
      .lt('scanned_at', period.endISO)
    ownPromoScans = ((scanRows ?? []) as { id: string }[]).length
  }

  // Trivia players who joined at the host's venues this month.
  const { data: tps } = await admin
    .from('trivia_players')
    .select('id')
    .in('venue_id', venueIds)
    .gte('created_at', period.startISO)
    .lt('created_at', period.endISO)
  const triviaPlayers = ((tps ?? []) as { id: string }[]).length

  return {
    hostUserId,
    hostEmail: profile?.email ?? null,
    hostName: profile?.full_name ?? null,
    period,
    venuesCount: venueIds.length,
    screenCount: tvIds.length,
    adsShown,
    advertiserCount,
    ownPromoPlays,
    ownPromoScans,
    triviaPlayers,
  }
}

export function hostReportSubject(r: HostReport): string {
  return `Your Loop screen recap for ${r.period.label}`
}

// Inline-styled HTML (renders across email clients), same dark + gold shell as the
// advertiser report. No dashes in copy.
export function renderHostReportHtml(r: HostReport, appUrl: string): string {
  const base = appUrl.replace(/\/$/, '')
  const greeting = r.hostName ? `Hi ${escapeHtml(r.hostName.split(' ')[0])},` : 'Hi,'
  const dashUrl = `${base}/host`
  const promoUrl = `${base}/host/promote`

  const stat = (label: string, value: string) => `
    <td width="33%" style="padding:14px;background:#111113;border:1px solid #27272a;border-radius:10px;">
      <div style="color:#71717a;font-size:12px;">${escapeHtml(label)}</div>
      <div style="margin-top:4px;color:#fafafa;font-size:22px;font-weight:700;">${escapeHtml(value)}</div>
    </td>`

  // Own-promo block: celebrate it when used, nudge it when not.
  const promoHtml =
    r.ownPromoPlays > 0 || r.ownPromoScans > 0
      ? `<div style="margin-top:20px;padding:14px 16px;background:#111113;border:1px solid #27272a;border-radius:10px;color:#d4d4d8;font-size:13px;line-height:1.6;">
           <div style="color:#fafafa;font-weight:600;">Your own promos</div>
           Your promos played ${formatNumber(r.ownPromoPlays)} time${r.ownPromoPlays === 1 ? '' : 's'} on your screen this month${
             r.ownPromoScans > 0
               ? ` and pulled ${formatNumber(r.ownPromoScans)} scan${r.ownPromoScans === 1 ? '' : 's'}`
               : ''
           }, at no cost to you.
         </div>`
      : `<div style="margin-top:20px;padding:14px 16px;background:#111113;border:1px solid #27272a;border-radius:10px;color:#d4d4d8;font-size:13px;line-height:1.6;">
           <div style="color:#fafafa;font-weight:600;">Advertise your own business, free</div>
           Your screen can show your own promo at no cost. Add a happy hour, an event, or a daily special and it plays right alongside the ads.
           <div style="margin-top:10px;"><a href="${promoUrl}" style="color:#d4a333;text-decoration:none;font-weight:600;">Add a promo &rsaquo;</a></div>
         </div>`

  const triviaLine =
    r.triviaPlayers > 0
      ? `<p style="margin:18px 0 0;color:#a1a1aa;font-size:13px;line-height:1.5;">${formatNumber(
          r.triviaPlayers
        )} ${r.triviaPlayers === 1 ? 'person' : 'people'} played trivia on your screen this month, time they spent looking right at it.</p>`
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
            <div style="margin-top:6px;color:#fafafa;font-size:20px;font-weight:700;">Your screen recap</div>
            <div style="margin-top:2px;color:#a1a1aa;font-size:13px;">${escapeHtml(r.period.label)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px;">
            <p style="margin:0 0 18px;color:#d4d4d8;font-size:14px;line-height:1.5;">${greeting}<br/>Here is what your ${
              r.screenCount === 1 ? 'screen' : 'screens'
            } did for you last month.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                ${stat('Ads shown', formatNumber(r.adsShown))}
                <td width="12"></td>
                ${stat('Local businesses', formatNumber(r.advertiserCount))}
                <td width="12"></td>
                ${stat('Trivia players', formatNumber(r.triviaPlayers))}
              </tr>
            </table>

            ${promoHtml}
            ${triviaLine}

            <div style="margin-top:18px;color:#71717a;font-size:12px;">
              Running on ${formatNumber(r.screenCount)} screen${r.screenCount === 1 ? '' : 's'} across ${formatNumber(
                r.venuesCount
              )} ${r.venuesCount === 1 ? 'location' : 'locations'}.
            </div>

            <div style="margin-top:24px;">
              <a href="${dashUrl}" style="display:inline-block;background:#d4a333;color:#0a0a0b;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:9px;">Open your dashboard</a>
            </div>

            <p style="margin:22px 0 0;color:#52525b;font-size:11px;line-height:1.5;">
              Ads shown is measured on the screen itself, counted only during your open hours. Thanks for hosting the loop.
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
