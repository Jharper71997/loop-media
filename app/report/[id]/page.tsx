import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildCampaignReport, periodForMonth, priorMonth } from '@/lib/reports'
import { CampaignReportView } from '@/components/app/CampaignReportView'

// Public, unguessable ROI report an advertiser forwards to a partner — keyed off
// the campaign's own uuid (no login). Private data (spend) is hidden by the view's
// publicView flag. Not indexable.
export const metadata: Metadata = {
  title: 'Campaign report — Loop Network',
  robots: { index: false, follow: false },
}

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const admin = createAdminClient()
  const { data: camp } = await admin
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!camp) notFound()

  // Show the current month; if it's empty (e.g. shared just after month rollover),
  // fall back to last month so the link never opens on a blank report.
  // eslint-disable-next-line react-hooks/purity -- server component; per-request timestamp is correct here
  const month = new Date().toISOString().slice(0, 7)
  let report = await buildCampaignReport(admin, id, periodForMonth(month))
  if (!report) notFound()
  if (report.totalPlays === 0 && report.totalScans === 0) {
    const prev = await buildCampaignReport(admin, id, periodForMonth(priorMonth()))
    if (prev && (prev.totalPlays > 0 || prev.totalScans > 0)) report = prev
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:py-12">
      <CampaignReportView report={report} publicView />
    </main>
  )
}
