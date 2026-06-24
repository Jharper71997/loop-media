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
      {/* Advertising lives in its own host tab now (no cross-app jump). */}
      <AppShell role="host">{children}</AppShell>
    </>
  )
}
