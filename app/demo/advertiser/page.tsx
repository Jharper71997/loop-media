import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BrandLockup } from '@/components/app/BrandLockup'
import { SignupForm } from '@/app/signup/SignupForm'
import { DEMO_ADVERTISER } from '@/lib/demo'

// Public entry to the guided ADVERTISER demo. Real sign-up form in demo mode
// (prefilled, category preset), then straight to the map to pick real screens,
// upload an ad, and mock-checkout (no charge, never placed on a real TV).
export const dynamic = 'force-dynamic'

export default async function DemoAdvertiserPage() {
  const profile = await getProfile()
  if (profile?.is_demo) redirect(profile.role === 'host' ? '/host' : '/advertiser')

  // Categories are readable only by authenticated users under RLS, but this page
  // is anonymous — read the catalog with the service role (id + name only).
  const admin = createAdminClient()
  const { data: cats } = await admin.from('categories').select('id, name').order('name')
  const categories = (cats ?? []) as { id: string; name: string }[]
  // Preset a believable line of business so the map has an obvious use case.
  const preset =
    categories.find((c) => /dentist|dental|restaurant|auto|coffee|fitness|gym/i.test(c.name)) ??
    categories[0]

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex justify-center">
          <BrandLockup className="h-20 w-auto" />
        </Link>
        <SignupForm
          demo
          categories={categories}
          defaultCategoryId={preset?.id}
          defaultFullName={DEMO_ADVERTISER.fullName}
          defaultEmail="you@northsidedental.com"
        />
      </div>
    </main>
  )
}
