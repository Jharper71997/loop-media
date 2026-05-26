import { redirect } from 'next/navigation'
import { requireProfile, homeForRole } from '@/lib/auth'
import { HostNav } from '@/components/host/HostNav'

export default async function HostLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireProfile()
  if (profile.role !== 'host') redirect(homeForRole(profile.role))

  return (
    <div className="flex min-h-screen flex-col">
      <HostNav email={profile.email} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
