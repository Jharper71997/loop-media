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

  // A host who advertises keeps their OWN shell (host nav + logo → /host) so the
  // buy flow feels like part of the host app, not a separate "advertiser app".
  // Pure advertisers (and admins previewing) get the advertiser shell.
  const shellRole = profile.role === 'host' ? 'host' : 'advertiser'

  return (
    <>
      {profile.role === 'admin' && <AdminPreviewBanner surface="advertiser" />}
      {/* Host nav lacks a campaigns tab, so give hosts a header link to their ads. */}
      <AppShell
        role={shellRole}
        crossLink={profile.role === 'host' ? { href: '/advertiser', label: 'My ads →' } : undefined}
      >
        {children}
      </AppShell>
    </>
  )
}
