import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { ScreenDarkCase } from './ScreenDarkCase'
import { AdvertiserCase } from './AdvertiserCase'
import { BillingCase } from './BillingCase'
import { UnsoldCase } from './UnsoldCase'

// One route for every case on the board, so a case link is always
// /admin/cases/<what is wrong>/<who it is about> and never a page-specific URL
// that has to be invented again the next time a new kind of problem shows up.

const KINDS = ['screen-dark', 'under-delivery', 'no-results', 'free-rider', 'money-overdue', 'unsold'] as const
type Kind = (typeof KINDS)[number]

export default async function CasePage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  await requireAdmin()
  const { kind, id } = await params
  if (!KINDS.includes(kind as Kind)) notFound()

  switch (kind as Kind) {
    case 'screen-dark':
      return <ScreenDarkCase tvId={id} />
    case 'under-delivery':
    case 'no-results':
      return <AdvertiserCase campaignId={id} kind={kind as 'under-delivery' | 'no-results'} />
    case 'free-rider':
    case 'money-overdue':
      return <BillingCase campaignId={id} kind={kind as 'free-rider' | 'money-overdue'} />
    case 'unsold':
      return <UnsoldCase venueId={id} />
  }
}
