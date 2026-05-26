'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'

const NAV = [
  { href: '/advertiser', label: 'Dashboard', exact: true },
  { href: '/advertiser/browse', label: 'Browse screens' },
  { href: '/advertiser/new', label: 'New campaign' },
]

export function AdvertiserNav({ email }: { email: string }) {
  const pathname = usePathname()
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/advertiser" className="font-semibold tracking-tight">
          Loop<span className="text-primary">Media</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1">
          {NAV.map((n) => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href)
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition',
                  active
                    ? 'bg-primary/10 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>
        <Link href="/advertiser/new" className={cn(buttonVariants({ size: 'sm' }), 'hidden sm:inline-flex')}>
          New campaign
        </Link>
        <span className="hidden text-xs text-muted-foreground md:inline">{email}</span>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out">
            <LogOut className="size-4" />
          </Button>
        </form>
      </div>
    </header>
  )
}
