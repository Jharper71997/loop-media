import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'
import { BrandLockup } from '@/components/app/BrandLockup'
import { cn } from '@/lib/utils'

export default async function Home() {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex w-full max-w-md flex-col items-center">
        <BrandLockup className="h-40 w-auto" />

        <span className="mt-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Facebook ads, but physical
        </span>

        <h1 className="mt-6 text-balance font-heading text-4xl font-extrabold leading-[1.05] tracking-tight">
          Get seen <span className="text-gold-metallic">where people go.</span>
        </h1>
        <p className="mt-4 text-pretty text-base text-muted-foreground">
          Your 15-second ad on the TVs in the busiest bars, gyms, and shops in town. Tap the spots
          you want on a map and you&apos;re live.
        </p>

        <div className="mt-8 flex w-full flex-col gap-3">
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: 'lg' }), 'h-12 w-full text-base')}
          >
            Start advertising
          </Link>
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'h-12 w-full text-base')}
          >
            Host a screen
          </Link>
          <Link
            href="/login"
            className="mt-1 text-sm text-muted-foreground hover:text-foreground"
          >
            Log in
          </Link>
        </div>
      </div>
    </main>
  )
}
