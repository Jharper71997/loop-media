import { redirect } from 'next/navigation'
import { requireProfile, homeForRole } from '@/lib/auth'
import { HostNav } from '@/components/host/HostNav'
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
    <div className="flex min-h-screen flex-col">
      {profile.role === 'admin' && <AdminPreviewBanner surface="host" />}
      <HostNav email={profile.email} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
