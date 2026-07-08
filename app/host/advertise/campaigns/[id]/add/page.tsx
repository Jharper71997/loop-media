// Host-side "add screens" — same picker as the advertiser flow, rendered under
// the host shell so back-links/redirects stay in /host/advertise.
import { renderAddScreens } from '@/app/advertiser/campaigns/[id]/add/page'

export default async function HostAddScreensPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return renderAddScreens(id, '/host/advertise')
}
