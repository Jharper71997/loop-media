import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import {
  buildWeeklyPayments,
  renderWeeklyPaymentsHtml,
  weeklyPaymentsSubject,
} from '@/lib/weeklyPayments'

// The Monday money email: who paid in the last 7 days across Loop Network and
// Jville Brew Loop. Scheduled weekly in vercel.json, but it also self gates to
// Monday so that moving it onto a daily schedule later cannot start sending a
// "weekly" report every morning.
//
// Protected by CRON_SECRET (Vercel sends it as Bearer).
// Manual / test run:
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/weekly-payments?dry=1"
//   ...&force=1              send on a day that is not Monday
//   ...&to=me@example.com    send to one address instead of the real recipients
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Overridable so the recipients can change without a code deploy.
const DEFAULT_TO = ['richard@jvillebrewloop.com', 'jvillebrewloop@gmail.com']

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'
  const dry = url.searchParams.get('dry') === '1'
  const toParam = url.searchParams.get('to')

  const now = new Date()
  if (!force && !dry && now.getUTCDay() !== 1) {
    return NextResponse.json({ skipped: 'not Monday', day: now.getUTCDay() })
  }

  // Test only: widen the window to check the report against more history.
  const daysParam = Number(url.searchParams.get('days'))
  const days = dry && Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 7

  const admin = createAdminClient()
  const report = await buildWeeklyPayments(admin, now.getTime(), days)

  // ?dry=1&html=1 returns the email body itself, so the thing that actually lands
  // in an inbox can be looked at before it is ever sent.
  if (dry && url.searchParams.get('html') === '1') {
    return new NextResponse(renderWeeklyPaymentsHtml(report), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  if (dry) {
    return NextResponse.json({
      dry: true,
      window: report.label,
      subject: weeklyPaymentsSubject(report),
      loopNetwork: report.loopNetworkCents,
      brewLoop: report.brewLoopCents,
      total: report.totalCents,
      payments: report.rows.length,
      warnings: report.warnings,
      rows: report.rows,
    })
  }

  const addresses = (s: string | undefined) =>
    (s ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const to = addresses(toParam ?? undefined).length
    ? addresses(toParam ?? undefined)
    : addresses(process.env.WEEKLY_PAYMENTS_TO).length
      ? addresses(process.env.WEEKLY_PAYMENTS_TO)
      : DEFAULT_TO

  const send = await sendEmail({
    to,
    subject: weeklyPaymentsSubject(report),
    html: renderWeeklyPaymentsHtml(report),
  })

  return NextResponse.json({
    window: report.label,
    to,
    total: report.totalCents,
    payments: report.rows.length,
    warnings: report.warnings,
    status: send.ok ? 'sent' : send.skipped ? 'skipped' : 'error',
    detail: send.ok ? send.id : send.skipped ? send.reason : send.error,
  })
}
