import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { SignupForm } from './SignupForm'

export default async function SignupPage() {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-6 block text-center text-lg font-semibold tracking-tight"
        >
          Loop<span className="text-primary">Media</span>
        </Link>
        <SignupForm />
      </div>
    </main>
  )
}
