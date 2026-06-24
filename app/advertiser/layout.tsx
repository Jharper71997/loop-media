import { redirect } from 'next/navigation'
import { requireProfile, homeForRole } from '@/lib/auth'
import { AppShell } from '@/components/app/AppShell'
import { AdminPreviewBanner } from '@/components/AdminPreviewBanner'

export default async function AdvertiserLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireProfile()
  // Hosts now advertise from inside their own app at /host/advertise, so a host
  // should never sit in the advertiser shell — send them there.
  if (profile.role === 'host') redirect('/host/advertise/browse')
  // Advertisers live here; admins may preview. Anyone else goes to their own home.
  if (!['advertiser', 'admin'].includes(profile.role)) {
    redirect(homeForRole(profile.role))
  }

  return (
    <>
      {profile.role === 'admin' && <AdminPreviewBanner surface="advertiser" />}
      <AppShell role="advertiser">{children}</AppShell>
    </>
  )
}
