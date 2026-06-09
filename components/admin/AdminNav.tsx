'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Store,
  Tv,
  Tags,
  Users,
  DollarSign,
  Map,
  Package,
  Megaphone,
  Menu,
  LogOut,
  UserCircle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean }
type NavGroup = { label: string | null; items: NavItem[] }

const GROUPS: NavGroup[] = [
  { label: null, items: [{ href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true }] },
  {
    label: 'Operations',
    items: [
      { href: '/admin/queue', label: 'Approval queue', icon: Inbox },
      { href: '/admin/map', label: 'Map', icon: Map },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/admin/venues', label: 'Venues', icon: Store },
      { href: '/admin/tvs', label: 'TVs', icon: Tv },
      { href: '/admin/categories', label: 'Categories & caps', icon: Tags },
      { href: '/admin/packages', label: 'Packages', icon: Package },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/admin/advertisers', label: 'Advertisers', icon: Users },
      { href: '/admin/revenue', label: 'Revenue', icon: DollarSign },
    ],
  },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-4">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {group.label && (
            <span className="px-3 pb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
              {group.label}
            </span>
          )}
          {group.items.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
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

function Wordmark() {
  return (
    <Link href="/admin" className="flex items-center gap-2 px-1">
      <Image
        src="/loop-network-emblem.png"
        alt="Loop Network"
        width={24}
        height={27}
        priority
        className="h-6 w-auto"
      />
      <span className="font-heading text-sm font-extrabold tracking-[0.16em]">
        <span className="text-primary">LOOP</span>{' '}
        <span className="text-muted-foreground">NETWORK</span>
      </span>
      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-primary">
        Admin
      </span>
    </Link>
  )
}

function SidebarBody({
  profile,
  territory,
  onNavigate,
}: {
  profile: Profile
  territory: TerritoryContext
  onNavigate?: () => void
}) {
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <Wordmark />

      <div className="space-y-1.5">
        <span className="px-1 text-xs text-muted-foreground">Territory</span>
        <TerritorySwitcher territory={territory} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} />
      </div>

      <div className="space-y-0.5 border-t border-border pt-4">
        <span className="px-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
          Preview as
        </span>
        <Link
          href="/advertiser"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Megaphone className="size-4 shrink-0" /> Advertiser app
        </Link>
        <Link
          href="/host"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Store className="size-4 shrink-0" /> Host app
        </Link>
      </div>

      <div className="border-t border-border pt-4">
        <p className="truncate px-2 text-xs text-muted-foreground">{profile.email}</p>
        <Link
          href="/admin/account"
          onClick={onNavigate}
          className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <UserCircle className="size-4 shrink-0" /> Account
        </Link>
        <form action="/auth/signout" method="post">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </form>
      </div>
    </div>
  )
}

export function AdminNav({
  profile,
  territory,
}: {
  profile: Profile
  territory: TerritoryContext
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card/30 md:block">
        <div className="sticky top-0 h-screen">
          <SidebarBody profile={profile} territory={territory} />
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
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
