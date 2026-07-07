import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BrandLockup } from '@/components/app/BrandLockup'
import { SignupForm } from './SignupForm'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  // This page is the advertiser sign-up. Hosts have their own public sign-up at
  // /signup/host, so bounce any legacy ?role=host link there.
  const { role } = await searchParams
  if (role === 'host') redirect('/signup/host')

  // Advertisers pick their category here at signup (it's saved to their account),
  // so the buy flow never asks again. The categories table's RLS only grants SELECT
  // to the authenticated role, but this page is anonymous (no account yet), so a
  // user-scoped read returns zero rows and the dropdown is empty. Read the global
  // catalog with the service-role client instead (non-sensitive: id + name only).
  const admin = createAdminClient()
  const { data: cats } = await admin.from('categories').select('id, name').order('name')
  const categories = (cats ?? []) as { id: string; name: string }[]

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex justify-center">
          <BrandLockup className="h-40 w-auto" />
        </Link>
        <SignupForm categories={categories} />
      </div>
    </main>
  )
}
