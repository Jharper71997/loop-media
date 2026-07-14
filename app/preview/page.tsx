import type { Metadata } from 'next'
import Link from 'next/link'
import { PreviewStudio } from '@/components/app/PreviewStudio'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'See your ad on a TV — Loop Network',
  description:
    'Upload your logo, photo, or video and instantly see it on a real Loop Network screen, exactly the way it airs in local bars, gyms, and shops.',
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-heading font-bold tracking-[0.16em] text-foreground', className)}>
      LOOP <span className="text-gold-metallic">NETWORK</span>
    </span>
  )
}

// Public, no-account "see your ad on a real screen" studio. Middleware leaves
// everything outside /admin,/advertiser,/host,/dashboard public, so this is reachable
// to any prospect straight off the marketing site.
export default function PreviewPage() {
  const year = new Date().getFullYear()

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/">
          <Wordmark className="text-base" />
        </Link>
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
          Log in
        </Link>
      </header>

      <section className="mx-auto w-full max-w-3xl px-6 pt-8 text-center lg:pt-12">
        <span className="inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Free preview, no sign-up
        </span>
        <h1 className="mt-5 text-balance font-heading text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
          That&apos;s your business, up on the{' '}
          <span className="text-gold-metallic">screen.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground">
          Drop in a logo, photo, or video and watch it land on a real Loop Network screen, framed
          exactly the way it plays in local spots around town.
        </p>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-10 lg:py-14">
        <PreviewStudio />
      </section>

      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <Wordmark className="text-sm" />
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Start advertising
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">© {year} Loop Network LLC</p>
        </div>
      </footer>
    </main>
  )
}
