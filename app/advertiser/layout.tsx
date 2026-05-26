import { redirect } from 'next/navigation'
import { requireProfile, homeForRole } from '@/lib/auth'
import { AdvertiserNav } from '@/components/advertiser/AdvertiserNav'

export default async function AdvertiserLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireProfile()
  if (profile.role !== 'advertiser') redirect(homeForRole(profile.role))

  return (
    <div className="flex min-h-screen flex-col">
      <AdvertiserNav email={profile.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
