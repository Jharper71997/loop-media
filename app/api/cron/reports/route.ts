import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/stripe'
import { sendEmail } from '@/lib/email'
import { resolveEmail } from '@/lib/emailSettings'
import {
  buildCampaignReport,
  periodForMonth,
  priorMonth,
  reportSubject,
  renderReportHtml,
} from '@/lib/reports'
import { buildHostReport, hostReportSubject, renderHostReportHtml } from '@/lib/hostReport'

// Monthly ROI report emails. This is a DAILY cron (Vercel Hobby allows only
// daily schedules; a sub-daily entry silently breaks all future deploys), so it
// self-gates: it only does work on the 1st of the month, emailing each active
// campaign its PRIOR calendar month report. report_log makes it exactly-once per
// (campaign, period) so a retry or manual run never double-sends.
//
// Protected by CRON_SECRET (Vercel sends it as Bearer).
// Manual / test run:
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/reports?force=1"
//   ...&month=2026-05            send a specific period instead of the prior month
//   ...&campaign=<id>            limit to one campaign (for spot checks)
//   ...&dry=1                    build + log nothing + don't send (returns preview counts)
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'
  const dry = url.searchParams.get('dry') === '1'
  const monthParam = url.searchParams.get('month')
  const onlyCampaign = url.searchParams.get('campaign')

  // Self-gate: on a scheduled run, only act on the 1st of the month.
  const now = new Date()
  if (!force && !monthParam && now.getUTCDate() !== 1) {
    return NextResponse.json({ skipped: 'not the 1st of the month', day: now.getUTCDate() })
  }

  const month = monthParam ?? priorMonth(now)
  const period = periodForMonth(month)
  const admin = createAdminClient()
  const base = appUrl()

  // Admin on/off + optional subject override for this email. Body stays the
  // data-generated report table; only the subject is editable at /admin/email.
  const emailCfg = await resolveEmail(admin, 'monthly_report', { month })
  // The advertiser-report toggle gates only the advertiser loop; the host recap
  // further down has its own toggle, so one can be off without disabling the other.
  const runCampaigns = emailCfg.enabled || dry

  // Active campaigns (optionally a single one for testing).
  let q = admin.from('campaigns').select('id').eq('status', 'active')
  if (onlyCampaign) q = q.eq('id', onlyCampaign)
  const { data: campaigns } = await q

  const results: Array<{ campaign: string; status: string; detail?: string }> = []

  for (const c of runCampaigns ? campaigns ?? [] : []) {
    // Skip if we already logged a send for this campaign + period.
    const { data: existing } = await admin
      .from('report_log')
      .select('id')
      .eq('campaign_id', c.id)
      .eq('period_month', month)
      .maybeSingle()
    if (existing && !force) {
      results.push({ campaign: c.id, status: 'already-sent' })
      continue
    }

    const report = await buildCampaignReport(admin, c.id, period)
    if (!report) {
      results.push({ campaign: c.id, status: 'no-campaign' })
      continue
    }
    if (!report.advertiserEmail) {
      results.push({ campaign: c.id, status: 'no-email' })
      continue
    }

    if (dry) {
      results.push({
        campaign: c.id,
        status: 'dry',
        detail: `${report.advertiserEmail} · ${report.totalScans} scans · ${report.locationsCount} screens`,
      })
      continue
    }

    const send = await sendEmail({
      to: report.advertiserEmail,
      // Use the admin's subject override when set, else the report's own subject.
      subject: emailCfg.custom.subject ? emailCfg.subject : reportSubject(report),
      html: renderReportHtml(report, base),
    })

    const logStatus = send.ok ? 'sent' : send.skipped ? 'skipped' : 'error'
    const detail = send.ok ? send.id : send.skipped ? send.reason : send.error

    // Record the attempt. On a real send (or a hard skip when the key is unset)
    // we log so we don't retry endlessly; on a transient error we still log the
    // error but upsert so a later run can replace it once email is configured.
    await admin
      .from('report_log')
      .upsert(
        {
          campaign_id: c.id,
          period_month: month,
          sent_to: report.advertiserEmail,
          status: logStatus,
          detail,
        },
        { onConflict: 'campaign_id,period_month' }
      )

    results.push({ campaign: c.id, status: logStatus, detail })
  }

  // ── Monthly HOST recap ("what your screen did for you") ───────────────────
  // Folded into this same daily cron (Hobby allows only daily schedules). Has its
  // own on/off toggle; skipped entirely on a single-campaign spot check.
  const hostCfg = await resolveEmail(admin, 'host_monthly_report', { month })
  const hostResults: Array<{ host: string; status: string; detail?: string }> = []
  if ((hostCfg.enabled || dry) && !onlyCampaign) {
    // Every host with at least one active venue.
    const { data: hostVenues } = await admin
      .from('venues')
      .select('host_user_id')
      .eq('status', 'active')
      .not('host_user_id', 'is', null)
    const hostIds = [
      ...new Set(((hostVenues ?? []) as { host_user_id: string }[]).map((v) => v.host_user_id)),
    ]

    for (const hostId of hostIds) {
      // Exactly-once per (host, period).
      const { data: existing } = await admin
        .from('host_report_log')
        .select('id')
        .eq('host_user_id', hostId)
        .eq('period_month', month)
        .maybeSingle()
      if (existing && !force) {
        hostResults.push({ host: hostId, status: 'already-sent' })
        continue
      }

      const report = await buildHostReport(admin, hostId, period)
      if (!report) {
        hostResults.push({ host: hostId, status: 'no-venue' })
        continue
      }
      if (!report.hostEmail) {
        hostResults.push({ host: hostId, status: 'no-email' })
        continue
      }
      // Don't send an all-zeros recap (a live screen with nothing to report yet).
      const noActivity =
        report.adsShown === 0 &&
        report.triviaPlayers === 0 &&
        report.ownPromoPlays === 0 &&
        report.ownPromoScans === 0
      if (noActivity) {
        hostResults.push({ host: hostId, status: 'no-activity' })
        continue
      }

      if (dry) {
        hostResults.push({
          host: hostId,
          status: 'dry',
          detail: `${report.hostEmail} · ${report.adsShown} shown · ${report.advertiserCount} advertisers · ${report.triviaPlayers} players`,
        })
        continue
      }

      const send = await sendEmail({
        to: report.hostEmail,
        subject: hostCfg.custom.subject ? hostCfg.subject : hostReportSubject(report),
        html: renderHostReportHtml(report, base),
      })
      const logStatus = send.ok ? 'sent' : send.skipped ? 'skipped' : 'error'
      const detail = send.ok ? send.id : send.skipped ? send.reason : send.error
      await admin.from('host_report_log').upsert(
        {
          host_user_id: hostId,
          period_month: month,
          sent_to: report.hostEmail,
          status: logStatus,
          detail,
        },
        { onConflict: 'host_user_id,period_month' }
      )
      hostResults.push({ host: hostId, status: logStatus, detail })
    }
  }

  return NextResponse.json({
    month,
    ran: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    results,
    hosts: {
      ran: hostResults.length,
      sent: hostResults.filter((r) => r.status === 'sent').length,
      results: hostResults,
    },
  })
}
