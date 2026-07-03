'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BottomNav, type AppRole } from './BottomNav'

// Responsive shell for the advertiser + host apps: a branded top bar, a content
// area that fills the screen on desktop (pages lay out in their own responsive
// grids), and a bottom tab bar. The guided build flow (browse + new) hides the
// tab bar so its own sticky CTA owns the bottom.
// Width policy: dashboards + the browse map go full-width so they use the whole
// screen; the focused buy-flow forms (new / creative) stay a comfortable reading
// column so inputs don't stretch across a wide monitor.
const WIDE = 'max-w-[1600px]'
export function AppShell({
  role,
  crossLink,
  children,
}: {
  role: AppRole
  // Optional link to the user's OTHER surface (a host who also advertises gets
  // "Advertise" on their venue side and "My venue" on the advertiser side).
  crossLink?: { href: string; label: string }
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const inFlow =
    pathname.startsWith('/advertiser/browse') ||
    pathname.startsWith('/advertiser/new') ||
    pathname.startsWith('/host/advertise/browse') ||
    pathname.startsWith('/host/advertise/new')
  // Hide the tab bar during the guided buy flow no matter which shell the user is
  // in (a host keeps their host nav, but the flow's sticky CTA owns the bottom).
  const hideNav = inFlow
  // Browse owns a full-width map + list; the other in-flow pages are focused forms
  // that read better in a narrower column.
  const isBrowse = pathname.includes('/browse')
  const isFlowForm = inFlow && !isBrowse

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 pt-[env(safe-area-inset-top)]">
        <div className={cn('mx-auto flex h-14 w-full items-center justify-between px-4 sm:px-6 lg:px-8', WIDE)}>
          <Link href={role === 'host' ? '/host' : '/advertiser'} className="flex items-center gap-2">
            <Image
              src="/loop-network-emblem.png"
              alt="Loop Network"
              width={26}
              height={29}
              priority
              className="h-7 w-auto"
            />
            <span className="font-heading text-sm font-extrabold tracking-[0.18em]">
              <span className="text-primary">LOOP</span>{' '}
              <span className="text-muted-foreground">NETWORK</span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5">
            {crossLink && (
              <Link
                href={crossLink.href}
                className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
              >
                {crossLink.label}
              </Link>
            )}
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out">
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full flex-1 px-4 pt-6 sm:px-6 lg:px-8',
          // Focused forms stay a readable column; everything else fills the screen.
          isFlowForm ? 'max-w-2xl' : WIDE,
          // In-flow pages have a fixed bottom CTA bar; reserve room so the last
          // card clears it. Out-of-flow pages reserve room for the tab bar.
          hideNav
            ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]'
            : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]'
        )}
      >
        {children}
      </main>

      {!hideNav && <BottomNav role={role} />}
    </div>
  )
}
