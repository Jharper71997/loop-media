import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { BrandLockup } from '@/components/app/BrandLockup'
import { SignupForm } from '../SignupForm'

// Public host sign-up. Lives under /signup (which has no gating layout) rather
// than /host/* — anything under /host requires an existing host session, which a
// brand-new host doesn't have yet. Once the account is created the form routes
// into /host/register, where the host gate now passes.
export default async function HostSignupPage() {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex justify-center">
          <BrandLockup className="h-20 w-auto" />
        </Link>
        <SignupForm role="host" />
      </div>
    </main>
  )
}
