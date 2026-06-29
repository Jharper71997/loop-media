import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { BrandLockup } from '@/components/app/BrandLockup'
import { SignupForm } from './SignupForm'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  // Honor a ?role=host deep-link from the landing "Host a screen" link so the
  // host card is preselected. Anything else (incl. the primary CTA) = advertiser.
  const { role } = await searchParams
  const initialRole = role === 'host' ? 'host' : 'advertiser'

  // Advertisers pick their category here at signup (it's saved to their account),
  // so the buy flow never asks again.
  const supabase = await createClient()
  const { data: cats } = await supabase.from('categories').select('id, name').order('name')
  const categories = (cats ?? []) as { id: string; name: string }[]

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex justify-center">
          <BrandLockup className="h-40 w-auto" />
        </Link>
        <SignupForm initialRole={initialRole} categories={categories} />
      </div>
    </main>
  )
}
