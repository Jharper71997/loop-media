import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { LoginForm } from './LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))
  const { next } = await searchParams

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-6 block text-center text-lg font-semibold tracking-tight"
        >
          Loop<span className="text-primary">Media</span>
        </Link>
        <LoginForm next={next ?? '/'} />
      </div>
    </main>
  )
}
