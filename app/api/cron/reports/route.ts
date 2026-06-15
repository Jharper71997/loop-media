import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/stripe'
import { sendEmail } from '@/lib/email'
import {
  buildCampaignReport,
  periodForMonth,
  priorMonth,
  reportSubject,
  renderReportHtml,
} from '@/lib/reports'

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

  // Active campaigns (optionally a single one for testing).
  let q = admin.from('campaigns').select('id').eq('status', 'active')
  if (onlyCampaign) q = q.eq('id', onlyCampaign)
  const { data: campaigns } = await q

  const results: Array<{ campaign: string; status: string; detail?: string }> = []

  for (const c of campaigns ?? []) {
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
      subject: reportSubject(report),
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

  return NextResponse.json({
    month,
    ran: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    results,
  })
}
