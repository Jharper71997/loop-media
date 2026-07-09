import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { BrandLockup } from '@/components/app/BrandLockup'
import { SignupForm } from '@/app/signup/SignupForm'
import { DEMO_HOST } from '@/lib/demo'

// Public entry to the guided HOST demo. Renders the real sign-up form in demo
// mode (prefilled, no email confirmation, no charge). Submitting mints a
// throwaway host account and walks the actual register → set-up → dashboard →
// map flow. Not gated: an admin or logged-out prospect can start it; a visitor
// already inside a demo jumps back into their walkthrough.
export const dynamic = 'force-dynamic'

export default async function DemoHostPage() {
  const profile = await getProfile()
  if (profile?.is_demo) redirect(profile.role === 'host' ? '/host' : '/advertiser')

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex justify-center">
          <BrandLockup className="h-20 w-auto" />
        </Link>
        <SignupForm
          role="host"
          demo
          defaultFullName={DEMO_HOST.fullName}
          defaultEmail="owner@sunrisecafe.com"
        />
      </div>
    </main>
  )
}
