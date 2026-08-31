'use client'

import { Suspense, use, useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import {
  Activity,
  PhoneCall,
  Clapperboard,
  LayoutGrid,
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
export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  match?: string[]
}
type NavGroup = { label: string | null; items: NavItem[] }

// THREE VERBS AND A DRAWER.
//
// The sidebar was organised by what the data IS — advertisers, screens, money,
// setup — which is how a database is organised, not how a day is. You do three
// things in here, and each one used to be scattered across sections: checking
// nothing is dark meant Today plus Screens plus Uptime; working the list meant
// Advertisers plus Pipeline plus Open inventory; getting an ad live meant
// Approvals plus Creative plus a venue page. Nouns made you assemble the job.
//
//   Watch — is anything dark, broken, or being short-changed right now
//   Sell  — the call list, in order, with what to say
//   Ship  — an ad from paid, to built, to approved, to on screen
//   More  — money, venues, settings, reports: real pages, just not daily ones
//
// Everything that used to be its own sidebar entry is still its own route; it
// now appears as a tab inside the verb it belongs to (see SectionTabs), so no
// bookmark, email link or muscle-memory URL broke.
export const VERBS: NavItem[] = [
  {
    href: '/admin',
    label: 'Watch',
    icon: Activity,
    exact: true,
    match: ['/admin/cases', '/admin/uptime', '/admin/venues', '/admin/tvs', '/admin/map'],
  },
  {
    href: '/admin/sell',
    label: 'Sell',
    icon: PhoneCall,
    match: ['/admin/pipeline', '/admin/advertisers', '/admin/deals', '/admin/reports'],
  },
  {
    href: '/admin/ship',
    label: 'Ship',
    icon: Clapperboard,
    match: ['/admin/queue', '/admin/creative', '/admin/house', '/admin/trivia'],
  },
  {
    href: '/admin/more',
    label: 'More',
    icon: LayoutGrid,
    match: [
      '/admin/money',
      '/admin/revenue',
      '/admin/settings',
      '/admin/pricing',
      '/admin/messages',
      '/admin/packages',
      '/admin/categories',
      '/admin/email',
      '/admin/territories',
      '/admin/account',
    ],
  },
]

const GROUPS: NavGroup[] = [{ label: null, items: VERBS }]

/** Shared by the sidebar and the phone tab bar so they cannot disagree. */
export function isVerbActive(item: NavItem, pathname: string): boolean {
  // `exact` only constrains the entry's own href (/admin is a prefix of every
  // admin route); its `match` prefixes still light it up.
  const hit = item.exact ? pathname === item.href : pathname.startsWith(item.href)
  return hit || (item.match ?? []).some((m) => pathname.startsWith(m))
}

// Badges arrive after the shell. NavLinks suspends on the promise; the fallback
// renders the identical nav with no counts, so the sidebar is usable instantly
// and the numbers appear in place without anything moving.
function NavBadges({
  countsPromise,
  onNavigate,
}: {
  countsPromise: Promise<Record<string, number>>
  onNavigate?: () => void
}) {
  return <NavLinks onNavigate={onNavigate} counts={use(countsPromise)} />
}

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
          {group.items.map((item) => {
            const { href, label, icon: Icon } = item
            const active = isVerbActive(item, pathname)
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
  countsPromise,
  onNavigate,
}: {
  profile: Profile
  territory: TerritoryContext
  countsPromise: Promise<Record<string, number>>
  onNavigate?: () => void
}) {
  return (
    <div data-ga-nav="admin_sidebar" className="flex h-full flex-col gap-3 p-3">
      <Wordmark />

      <TerritorySwitcher territory={territory} />

      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<NavLinks onNavigate={onNavigate} />}>
          <NavBadges countsPromise={countsPromise} onNavigate={onNavigate} />
        </Suspense>
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
  countsPromise,
}: {
  profile: Profile
  territory: TerritoryContext
  // Live badge counts keyed by nav href (e.g. { '/admin/queue': 3 }), resolved
  // after the shell paints rather than before it.
  countsPromise: Promise<Record<string, number>>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-border bg-card/30 md:block">
        <div className="sticky top-0 h-screen">
          <SidebarBody profile={profile} territory={territory} countsPromise={countsPromise} />
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
              countsPromise={countsPromise}
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Phone tab bar.
          Every navigation on a phone used to cost two taps and a slide-out
          panel: open the hamburger, wait for the sheet, aim at a 32px row. The
          four things you actually do are now one thumb-reachable tap from
          anywhere, and the sheet keeps its job as the drawer for the long tail.
          pb-[env(safe-area-inset-bottom)] keeps the row clear of the iPhone home
          indicator, which otherwise sits directly on top of "Ship". */}
      <nav
        data-ga-nav="admin_tabbar"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <Suspense fallback={<TabBarLinks />}>
          <TabBarBadges countsPromise={countsPromise} />
        </Suspense>
      </nav>
    </>
  )
}

function TabBarBadges({ countsPromise }: { countsPromise: Promise<Record<string, number>> }) {
  return <TabBarLinks counts={use(countsPromise)} />
}

function TabBarLinks({ counts }: { counts?: Record<string, number> }) {
  const pathname = usePathname()
  return (
    <>
      {VERBS.map((item) => {
        const active = isVerbActive(item, pathname)
        const Icon = item.icon
        const n = counts?.[item.href] ?? 0
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              active ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
              {n > 0 && (
                <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-primary px-1 text-center font-mono text-[9px] font-semibold leading-4 text-primary-foreground">
                  {n > 99 ? '99+' : n}
                </span>
              )}
            </span>
            {item.label}
          </Link>
        )
      })}
    </>
  )
}
