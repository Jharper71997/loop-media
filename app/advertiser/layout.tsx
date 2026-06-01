import { redirect } from 'next/navigation'
import { requireProfile, homeForRole } from '@/lib/auth'
import { AdvertiserNav } from '@/components/advertiser/AdvertiserNav'
import { AdminPreviewBanner } from '@/components/AdminPreviewBanner'

export default async function AdvertiserLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireProfile()
  // Admins may preview this surface; everyone else is sent to their own home.
  if (profile.role !== 'advertiser' && profile.role !== 'admin') {
    redirect(homeForRole(profile.role))
  }

  return (
    <div className="flex min-h-screen flex-col">
      {profile.role === 'admin' && <AdminPreviewBanner surface="advertiser" />}
      <AdvertiserNav email={profile.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
