'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BottomNav, type AppRole } from './BottomNav'

// Mobile-first shell for the advertiser + host apps: a slim branded top bar, a
// phone-width content column, and a bottom tab bar. The guided build flow
// (browse + new) hides the tab bar so its own sticky CTA owns the bottom.
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
    pathname.startsWith('/advertiser/browse') || pathname.startsWith('/advertiser/new')
  // Hide the tab bar during the guided buy flow no matter which shell the user is
  // in (a host keeps their host nav, but the flow's sticky CTA owns the bottom).
  const hideNav = inFlow

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-4">
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
        className={
          'mx-auto w-full max-w-md flex-1 px-4 pt-4 ' +
          (hideNav ? 'pb-4' : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]')
        }
      >
        {children}
      </main>

      {!hideNav && <BottomNav role={role} />}
    </div>
  )
}
