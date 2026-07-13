import { redirect } from 'next/navigation'
import { requireProfile, homeForRole } from '@/lib/auth'
import { AppShell } from '@/components/app/AppShell'
import { AdminPreviewBanner } from '@/components/AdminPreviewBanner'
import { DemoBanner } from '@/components/DemoBanner'
import { HostTourProvider } from '@/components/app/tour/HostTour'

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

  // Auto-run the first-run walkthrough once for a real host who hasn't seen it.
  // Not for admins previewing, and not on top of the demo sales walkthrough.
  const autoStartTour = profile.role === 'host' && !profile.is_demo && !profile.onboarding_host_done

  return (
    <HostTourProvider autoStart={autoStartTour}>
      {profile.is_demo && <DemoBanner />}
      {profile.role === 'admin' && <AdminPreviewBanner surface="host" />}
      {/* Advertising lives in its own host tab now (no cross-app jump). */}
      <AppShell role="host">{children}</AppShell>
    </HostTourProvider>
  )
}
