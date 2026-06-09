import Link from 'next/link'
import Image from 'next/image'
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
        <Link href="/" className="mb-6 flex justify-center">
          <span className="rounded-2xl bg-[#0c0c0e] p-5">
            <Image
              src="/loop-network-logo.png"
              alt="Loop Network"
              width={150}
              height={150}
              priority
              className="h-28 w-auto"
            />
          </span>
        </Link>
        <LoginForm next={next ?? '/'} />
      </div>
    </main>
  )
}
