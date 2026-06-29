'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  BarChart3,
  Plus,
  MapPin,
  User,
  Store,
  Megaphone,
  MonitorPlay,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppRole = 'advertiser' | 'host'

type Tab = { href: string; label: string; icon: LucideIcon; exact?: boolean; primary?: boolean }

const TABS: Record<AppRole, Tab[]> = {
  advertiser: [
    { href: '/advertiser', label: 'Home', icon: Home, exact: true },
    { href: '/advertiser/results', label: 'Results', icon: BarChart3 },
    { href: '/advertiser/browse', label: 'New', icon: Plus, primary: true },
    { href: '/advertiser/locations', label: 'Locations', icon: MapPin },
    { href: '/advertiser/account', label: 'Account', icon: User },
  ],
  host: [
    { href: '/host', label: 'Venue', icon: Store, exact: true },
    { href: '/host/advertise', label: 'Advertise', icon: MonitorPlay },
    { href: '/host/promos', label: 'Promos', icon: Megaphone },
    { href: '/host/account', label: 'Account', icon: User },
  ],
}

export function BottomNav({ role }: { role: AppRole }) {
  const pathname = usePathname()
  const tabs = TABS[role]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div
        className={cn(
          'mx-auto grid w-full max-w-md',
          tabs.length === 5 ? 'grid-cols-5' : tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
        )}
      >
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
          const Icon = t.icon
          if (t.primary) {
            return (
              <Link
                key={t.href}
                href={t.href}
                className="flex flex-col items-center justify-center gap-1 py-2"
              >
                <span className="-mt-5 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-4 ring-background">
                  <Icon className="size-6" />
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">{t.label}</span>
              </Link>
            )
          }
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-3 text-[11px] font-medium transition',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-5" />
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
