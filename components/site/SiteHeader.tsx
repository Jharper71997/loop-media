'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cn } from '@/lib/utils'
import { SITE_TABS, SITE_SECONDARY, type SiteTab } from './SiteNav'

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-heading font-bold tracking-[0.16em] text-foreground', className)}>
      LOOP <span className="text-gold-metallic">NETWORK</span>
    </span>
  )
}

// Sticky public-site header: a wordmark, the tab row on desktop, and a hamburger
// that opens a left sidebar drawer on phones (which is where Jacob reads the site).
// Every marketing page renders this, so the tabs are reachable from anywhere.
export function SiteHeader() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Anchor tabs ("/#how", "/#pricing") never take the current state: they all
  // live on the home page, so keying off the pathname would light up every one of
  // them at once, and tracking which section is on screen isn't worth a scroll
  // observer here. Only real routes get highlighted.
  const isCurrent = (t: SiteTab) => !t.anchor && pathname.startsWith(t.href)

  return (
    <header
      data-ga-nav="marketing_header"
      className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 pt-[env(safe-area-inset-top)]"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Image
            src="/loop-network-emblem.png"
            alt=""
            width={26}
            height={29}
            priority
            className="h-6 w-auto"
          />
          <Wordmark className="text-sm sm:text-base" />
        </Link>

        {/* Desktop tabs */}
        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {SITE_TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium transition',
                isCurrent(t)
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link
            href="/login"
            className="hidden px-2 text-sm text-muted-foreground transition hover:text-foreground sm:inline"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className={cn(buttonVariants(), 'hidden h-9 shrink-0 px-3.5 sm:inline-flex')}
          >
            Start advertising
          </Link>

          {/* Mobile: the sidebar */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon-lg" aria-label="Open menu" className="lg:hidden" />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[19rem] gap-0 p-0 sm:max-w-[19rem]">
              {/* The dialog needs an accessible name even though the wordmark
                  below is the visible header. */}
              <SheetTitle className="sr-only">Site menu</SheetTitle>
              <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                <Image
                  src="/loop-network-emblem.png"
                  alt=""
                  width={26}
                  height={29}
                  className="h-6 w-auto"
                />
                <Wordmark className="text-sm" />
              </div>

              <nav className="flex-1 overflow-y-auto p-3">
                {SITE_TABS.map((t) => (
                  <DrawerLink key={t.href} tab={t} current={isCurrent(t)} onNavigate={() => setOpen(false)} />
                ))}
                <div className="my-3 border-t border-border" />
                {SITE_SECONDARY.map((t) => (
                  <DrawerLink key={t.href} tab={t} current={isCurrent(t)} onNavigate={() => setOpen(false)} />
                ))}
              </nav>

              <div className="space-y-2 border-t border-border p-4">
                <Link
                  href="/signup"
                  onClick={() => setOpen(false)}
                  className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
                >
                  Start advertising
                </Link>
                <div className="flex items-center justify-between">
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="px-1 text-sm text-muted-foreground transition hover:text-foreground"
                  >
                    Log in
                  </Link>
                  <ThemeToggle />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

function DrawerLink({
  tab,
  current,
  onNavigate,
}: {
  tab: SiteTab
  current: boolean
  onNavigate: () => void
}) {
  const Icon = tab.icon
  return (
    <Link
      href={tab.href}
      onClick={onNavigate}
      className={cn(
        'flex items-start gap-3 rounded-xl px-3 py-2.5 transition',
        current ? 'bg-accent' : 'hover:bg-accent/60'
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', current ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{tab.label}</span>
        <span className="block text-xs leading-snug text-muted-foreground">{tab.blurb}</span>
      </span>
    </Link>
  )
}
