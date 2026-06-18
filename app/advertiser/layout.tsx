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
  // Advertisers live here; admins may preview; hosts may advertise elsewhere
  // (they get 20% off). Anyone else goes to their own home.
  if (!['advertiser', 'admin', 'host'].includes(profile.role)) {
    redirect(homeForRole(profile.role))
  }

  return (
    <>
      {profile.role === 'admin' && <AdminPreviewBanner surface="advertiser" />}
      {/* A host advertising here gets a way back to their venue dashboard. */}
      <AppShell
        role="advertiser"
        crossLink={profile.role === 'host' ? { href: '/host', label: '← My venue' } : undefined}
      >
        {children}
      </AppShell>
    </>
  )
}
