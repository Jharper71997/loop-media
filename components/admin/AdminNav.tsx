'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Store,
  Tv,
  Tags,
  Users,
  Menu,
  LogOut,
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

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/queue', label: 'Approval queue', icon: Inbox },
  { href: '/admin/venues', label: 'Venues', icon: Store },
  { href: '/admin/tvs', label: 'TVs', icon: Tv },
  { href: '/admin/categories', label: 'Categories & caps', icon: Tags },
  { href: '/admin/advertisers', label: 'Advertisers', icon: Users },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
              active
                ? 'bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function TerritorySwitcher({ territory }: { territory: TerritoryContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const value = territory.activeId ?? 'all'

  if (territory.locked) {
    const name =
      territory.territories.find((t) => t.id === territory.activeId)?.name ??
      'Your territory'
    return (
      <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
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
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/admin" className="px-2 text-lg font-semibold tracking-tight">
        Loop<span className="text-primary">Media</span>
        <span className="ml-2 align-middle text-[10px] uppercase tracking-widest text-muted-foreground">
          Admin
        </span>
      </Link>

      <div className="space-y-1.5">
        <span className="px-1 text-xs text-muted-foreground">Territory</span>
        <TerritorySwitcher territory={territory} />
      </div>

      <div className="flex-1">
        <NavLinks onNavigate={onNavigate} />
      </div>

      <div className="border-t border-border pt-4">
        <p className="truncate px-2 text-xs text-muted-foreground">{profile.email}</p>
        <form action="/auth/signout" method="post">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start text-muted-foreground"
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
      <aside className="hidden w-64 shrink-0 border-r border-border md:block">
        <div className="sticky top-0 h-screen">
          <SidebarBody profile={profile} territory={territory} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-border p-3 md:hidden">
        <Link href="/admin" className="text-base font-semibold tracking-tight">
          Loop<span className="text-primary">Media</span>
        </Link>
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
