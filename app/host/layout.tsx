import { redirect } from 'next/navigation'
import { requireProfile, homeForRole } from '@/lib/auth'
import { AppShell } from '@/components/app/AppShell'
import { AdminPreviewBanner } from '@/components/AdminPreviewBanner'

export default async function HostLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireProfile()
  // Admins may preview this surface; everyone else is sent to their own home.
  if (profile.role !== 'host' && profile.role !== 'admin') {
    redirect(homeForRole(profile.role))
  }

  return (
    <>
      {profile.role === 'admin' && <AdminPreviewBanner surface="host" />}
      {/* Hosts can also advertise (20% off), so give them a way over to it. */}
      <AppShell role="host" crossLink={{ href: '/advertiser', label: 'Advertise →' }}>
        {children}
      </AppShell>
    </>
  )
}
