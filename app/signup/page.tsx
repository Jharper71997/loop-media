import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { BrandLockup } from '@/components/app/BrandLockup'
import { SignupForm } from './SignupForm'

export default async function SignupPage() {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex justify-center">
          <BrandLockup className="h-24 w-auto" />
        </Link>
        <SignupForm />
      </div>
    </main>
  )
}
