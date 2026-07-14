import { notFound } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/stripe'
import { buildCampaignReport, periodForMonth, priorMonth } from '@/lib/reports'
import { CampaignReportView } from '@/components/app/CampaignReportView'
import { BackLink } from '../BackLink'
import { ReportToolbar } from './ReportToolbar'

// The advertiser's in-app ROI report: the same presentation-grade view they can
// forward publicly (/report/[id]), plus controls to pick the month, copy the
// share link, and print / save as PDF. Ownership-checked; admins can view too.
export default async function CampaignReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const profile = await requireProfile()
  const { id } = await params
  const { month: monthParam } = await searchParams
  const supabase = await createClient()

  const { data: camp } = await supabase
    .from('campaigns')
    .select('id, advertiser_id')
    .eq('id', id)
    .maybeSingle()
  if (!camp || (camp.advertiser_id !== profile.id && profile.role !== 'admin')) notFound()

  // Last 6 calendar months for the picker (current first).
  // eslint-disable-next-line react-hooks/purity -- server component; per-request timestamp is correct here
  const now = new Date()
  const months: { value: string; label: string }[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push({
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    })
  }
  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : months[0].value

  const admin = createAdminClient()
  let report = await buildCampaignReport(admin, id, periodForMonth(month))
  if (!report) notFound()
  // If the default (current) month has nothing yet, fall back to last month so the
  // first thing they see isn't an empty report. Explicit ?month= is respected.
  if (!monthParam && report.totalPlays === 0 && report.totalScans === 0) {
    const prev = await buildCampaignReport(admin, id, periodForMonth(priorMonth()))
    if (prev && (prev.totalPlays > 0 || prev.totalScans > 0)) report = prev
  }

  const shareUrl = `${appUrl().replace(/\/$/, '')}/report/${id}`

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <BackLink />
      </div>
      <ReportToolbar months={months} month={report.period.month} shareUrl={shareUrl} />
      <CampaignReportView report={report} />
    </div>
  )
}
