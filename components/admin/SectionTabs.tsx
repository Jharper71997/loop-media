'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Sub-navigation inside a merged admin section.
//
// The sidebar used to list all thirteen admin pages flat, which meant scanning a
// wall of links to find the one screen you wanted. The sidebar now carries the
// seven things you actually do; the pages that belong to one of them (Screens,
// Content, Setup) keep their own routes and appear here as tabs. No route moved,
// so every existing deep link, email and bookmark still lands.

export type SectionTab = { href: string; label: string; badge?: number }

export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname()
  return (
    <div className="-mb-px flex gap-1 overflow-x-auto border-b border-border px-3 md:px-4">
      {tabs.map((tab) => {
        // Exact match, or a child route (…/venues/<id> keeps "Venues" lit).
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-1.5 text-[13px] transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {!!tab.badge && tab.badge > 0 && (
              <span className="min-w-5 rounded-full bg-primary/15 px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums text-primary">
                {tab.badge}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

// The three merged sections. Kept here so the sidebar and the pages agree on
// what belongs where — the sidebar link for a section points at its first tab.
export const SCREEN_TABS: SectionTab[] = [
  { href: '/admin/venues', label: 'Venues & screens' },
  { href: '/admin/uptime', label: 'Uptime' },
  { href: '/admin/map', label: 'Map' },
]

export const CONTENT_TABS: SectionTab[] = [
  { href: '/admin/queue', label: 'Approvals' },
  { href: '/admin/creative', label: 'Creative help' },
  { href: '/admin/house', label: 'House slides' },
  { href: '/admin/trivia', label: 'Trivia' },
]

// Packages and categories are already folded into the pricing page (both routes
// redirect there), so they are not separate tabs. Business settings leads
// because it is the one page that can change any number in the app.
export const SETUP_TABS: SectionTab[] = [
  { href: '/admin/settings', label: 'Business settings' },
  { href: '/admin/pricing', label: 'Pricing & packages' },
  { href: '/admin/messages', label: 'Templates' },
  { href: '/admin/email', label: 'Emails' },
  { href: '/admin/account', label: 'Account' },
]
