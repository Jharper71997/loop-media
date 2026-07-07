import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { BrandLockup } from '@/components/app/BrandLockup'
import { UpdatePasswordForm } from './UpdatePasswordForm'

// Reached after clicking a recovery link (via /auth/callback, which set a
// session). Must be signed in to set a new password.
export default async function UpdatePasswordPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login?error=auth_link')

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex justify-center">
          <BrandLockup className="h-20 w-auto" />
        </Link>
        <UpdatePasswordForm role={profile.role} />
      </div>
    </main>
  )
}
