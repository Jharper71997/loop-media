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

export type SectionTab = { href: string; label: string; badge?: number; exact?: boolean }

export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname()
  return (
    <div className="-mb-px flex gap-1 overflow-x-auto border-b border-border px-3 md:px-4">
      {tabs.map((tab) => {
        // Exact match, or a child route (…/venues/<id> keeps "Venues" lit).
        // `exact` exists for /admin itself, which is a prefix of every other route.
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
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

// The merged sections. Kept here so the sidebar and the pages agree on what
// belongs where — the sidebar link for a section points at its first tab.
//
// Five sections, named for the four questions the business runs on: what needs
// doing today, who is paying us, are the screens working, where is the money,
// and the configuration you touch twice a year.

// Today owns the work that lands on you daily. Approvals, house slides and
// trivia are all "content going onto screens", which is a today job, not a
// destination you go browsing.
export const TODAY_TABS: SectionTab[] = [
  { href: '/admin', label: 'Board', exact: true },
  { href: '/admin/queue', label: 'Approvals' },
  { href: '/admin/creative', label: 'Creative help' },
  { href: '/admin/house', label: 'House slides' },
  { href: '/admin/trivia', label: 'Trivia' },
]

// Everything about getting more advertisers paying more, in the order you walk
// it: who we have, who we are chasing, what is left to sell, how it performed.
export const ADVERTISER_TABS: SectionTab[] = [
  { href: '/admin/advertisers', label: 'Advertisers' },
  { href: '/admin/pipeline', label: 'Pipeline' },
  { href: '/admin/sell', label: 'Open inventory' },
  { href: '/admin/reports', label: 'Reports' },
]

export const SCREEN_TABS: SectionTab[] = [
  { href: '/admin/venues', label: 'Venues & screens' },
  { href: '/admin/uptime', label: 'Uptime' },
  { href: '/admin/map', label: 'Map' },
]

export const MONEY_TABS: SectionTab[] = [
  { href: '/admin/money', label: 'Billing' },
  { href: '/admin/revenue', label: 'Revenue' },
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
