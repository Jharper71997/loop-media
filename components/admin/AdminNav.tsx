'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Store,
  Users,
  DollarSign,
  Settings,
  Menu,
  LogOut,
  UserCircle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { Profile } from '@/lib/db.types'
import type { TerritoryContext } from '@/lib/territory'
import { setActiveTerritory } from '@/app/(admin)/admin/territory-actions'

// `match` lists the extra route prefixes that belong to a merged section, so the
// sidebar entry stays lit while you move between that section's tabs (see
// components/admin/SectionTabs.tsx). `href` is always the section's first tab.
type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  match?: string[]
}
type NavGroup = { label: string | null; items: NavItem[] }

// Five entries. Each is a question the business runs on, not a table:
//
//   Today       — what is broken, owed, or waiting on me right now
//   Advertisers — who pays us, who might, and what is left to sell
//   Screens     — are the things we sell actually working
//   Money       — what came in, and what is going to
//   Setup       — the numbers and copy you change twice a year
//
// Everything that used to be its own sidebar entry is still its own route; it
// now appears as a tab inside the section it belongs to (see SectionTabs), so no
// bookmark, email link or muscle-memory URL broke.
const GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      {
        href: '/admin',
        label: 'Today',
        icon: LayoutDashboard,
        exact: true,
        match: ['/admin/cases', '/admin/queue', '/admin/creative', '/admin/house', '/admin/trivia'],
      },
    ],
  },
  {
    label: 'Grow',
    items: [
      {
        href: '/admin/advertisers',
        label: 'Advertisers',
        icon: Users,
        match: ['/admin/pipeline', '/admin/sell', '/admin/deals', '/admin/reports'],
      },
      { href: '/admin/money', label: 'Money', icon: DollarSign, match: ['/admin/revenue'] },
    ],
  },
  {
    label: 'Run',
    items: [
      {
        href: '/admin/venues',
        label: 'Screens',
        icon: Store,
        match: ['/admin/uptime', '/admin/map', '/admin/tvs'],
      },
    ],
  },
  {
    label: null,
    items: [
      {
        href: '/admin/settings',
        label: 'Setup',
        icon: Settings,
        match: [
          '/admin/pricing',
          '/admin/messages',
          '/admin/packages',
          '/admin/categories',
          '/admin/email',
          '/admin/account',
        ],
      },
    ],
  },
]

function NavLinks({
  onNavigate,
  counts,
}: {
  onNavigate?: () => void
  counts?: Record<string, number>
}) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-2.5">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-px">
          {group.label && (
            <span className="px-2.5 pb-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
              {group.label}
            </span>
          )}
          {group.items.map(({ href, label, icon: Icon, exact, match }) => {
            // `exact` only constrains the entry's own href (/admin is a prefix of
            // every admin route); its `match` prefixes still light it up.
            const hit = exact ? pathname === href : pathname.startsWith(href)
            const active = hit || (match ?? []).some((m) => pathname.startsWith(m))
            const n = counts?.[href] ?? 0
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className={cn(
                  'relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {active && (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
                )}
                <Icon className={cn('size-4 shrink-0', active && 'text-primary')} />
                {label}
                {n > 0 && (
                  <span className="ml-auto min-w-5 rounded-full bg-primary/15 px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold tabular-nums text-primary">
                    {n}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function TerritorySwitcher({ territory }: { territory: TerritoryContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const value = territory.activeId ?? 'all'

  if (territory.locked) {
    const name =
      territory.territories.find((t) => t.id === territory.activeId)?.name ?? 'Your territory'
    return (
      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
        {name}
      </div>
    )
  }

  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(v) =>
        startTransition(async () => {
          await setActiveTerritory(v ?? 'all')
          router.refresh()
        })
      }
    >
      <SelectTrigger className="w-full" size="sm">
        <SelectValue>
          {(val: string | null) =>
            val && val !== 'all'
              ? territory.territories.find((t) => t.id === val)?.name ?? 'Territory'
              : 'All territories'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All territories</SelectItem>
        {territory.territories.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Tracking and size are tuned to the 224px sidebar: at the old 0.16em the
// wordmark wrapped onto a second line, which cost a row of height on every page
// for no information.
function Wordmark() {
  return (
    <Link href="/admin" className="flex items-center gap-1.5 px-1">
      <Image
        src="/loop-network-emblem.png"
        alt="Loop Network"
        width={24}
        height={27}
        priority
        className="h-5 w-auto"
      />
      <span className="whitespace-nowrap font-heading text-[13px] font-extrabold tracking-[0.1em]">
        <span className="text-primary">LOOP</span>{' '}
        <span className="text-muted-foreground">NETWORK</span>
      </span>
      <span className="ml-auto rounded bg-primary/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
        Admin
      </span>
    </Link>
  )
}

function SidebarBody({
  profile,
  territory,
  counts,
  onNavigate,
}: {
  profile: Profile
  territory: TerritoryContext
  counts?: Record<string, number>
  onNavigate?: () => void
}) {
  return (
    <div data-ga-nav="admin_sidebar" className="flex h-full flex-col gap-3 p-3">
      <Wordmark />

      <TerritorySwitcher territory={territory} />

      <div className="flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} counts={counts} />
      </div>

      <div className="border-t border-border pt-2">
        <div className="flex items-center justify-between gap-2 px-1.5">
          <p className="truncate text-[11px] text-muted-foreground">{profile.email}</p>
          <ThemeToggle className="-mr-1 shrink-0" />
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <Link
            href="/admin/account"
            onClick={onNavigate}
            className="flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <UserCircle className="size-4 shrink-0" /> Account
          </Link>
          <form action="/auth/signout" method="post">
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              title="Sign out"
            >
              <LogOut className="size-4" />
              <span className="sr-only">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

export function AdminNav({
  profile,
  territory,
  counts,
}: {
  profile: Profile
  territory: TerritoryContext
  // Live badge counts keyed by nav href (e.g. { '/admin/queue': 3 }).
  counts?: Record<string, number>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-border bg-card/30 md:block">
        <div className="sticky top-0 h-screen">
          <SidebarBody profile={profile} territory={territory} counts={counts} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/85 px-3 py-2.5 backdrop-blur md:hidden">
        <Wordmark />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={<Button variant="outline" size="icon" />}>
            <Menu className="size-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SidebarBody
              profile={profile}
              territory={territory}
              counts={counts}
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
