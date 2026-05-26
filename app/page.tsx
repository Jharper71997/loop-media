import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile, homeForRole } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'

export default async function Home() {
  const profile = await getProfile()
  if (profile) redirect(homeForRole(profile.role))

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <span className="text-lg font-semibold tracking-tight">
          Loop<span className="text-primary">Media</span>
        </span>
        <div className="flex items-center gap-2">
          <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Log in
          </Link>
          <Link href="/signup" className={buttonVariants({ size: 'sm' })}>
            Get started
          </Link>
        </div>
      </header>

      <section className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <span className="mb-4 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Facebook Ads, but physical
        </span>
        <h1 className="text-balance text-4xl font-bold tracking-tight md:text-6xl">
          Put your business on screens all over town.
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-lg text-muted-foreground">
          Loop Media runs your 15-second ad across TVs in the busiest bars, gyms,
          barber shops and breweries in your city. Pick a reach goal, we place it.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
            Start advertising
          </Link>
          <Link
            href="/signup"
            className={buttonVariants({ size: 'lg', variant: 'outline' })}
          >
            Host a screen
          </Link>
        </div>
      </section>
    </main>
  )
}
