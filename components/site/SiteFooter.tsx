import Link from 'next/link'
import { SITE_TABS, SITE_SECONDARY } from './SiteNav'
import { Wordmark } from './SiteHeader'

// Shared public footer. Carries the same tabs as the header so the site's shape
// is legible from the bottom of any page too, plus the legal links.
export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t border-border bg-wash">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-xs space-y-3">
            <Wordmark className="text-sm" />
            <p className="text-sm text-muted-foreground">
              Local TV advertising you can actually measure, on the screens in the bars, gyms and
              shops around Jacksonville, NC.
            </p>
          </div>

          <nav
            data-ga-nav="marketing_footer"
            className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:grid-cols-2"
          >
            {[...SITE_TABS, ...SITE_SECONDARY].map((t) => (
              <Link key={t.href} href={t.href} className="text-muted-foreground hover:text-foreground">
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {year} Loop Network LLC</p>
          <nav className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
