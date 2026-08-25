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

// The verbs, expanded.
//
// The sidebar carries four things you DO; every page that belongs to one of them
// appears here as a tab. No route moved, so every existing deep link, email and
// bookmark still lands — what changed is which pages sit next to each other, and
// that now follows the job rather than the schema.

// Watch — is anything dark, broken, or being short-changed right now. The board
// is the answer; venues, uptime and the map are how you go look at the hardware
// behind it. These used to be two separate sections, which meant "is that screen
// really down" was a trip across the sidebar.
export const WATCH_TABS: SectionTab[] = [
  { href: '/admin', label: 'Board', exact: true },
  { href: '/admin/venues', label: 'Venues & screens' },
  { href: '/admin/uptime', label: 'Uptime' },
  { href: '/admin/map', label: 'Map' },
]

// Sell — the call list first, because that is the thing you work. Everything
// after it is where a name on that list came from.
export const SELL_TABS: SectionTab[] = [
  { href: '/admin/sell', label: 'Call list' },
  { href: '/admin/pipeline', label: 'Pipeline' },
  { href: '/admin/advertisers', label: 'Advertisers' },
  { href: '/admin/reports', label: 'Reports' },
]

// Ship — an ad from paid to on screen. Approvals, creative and the house content
// were three separate destinations for one pipeline; the queue is the pipeline.
export const SHIP_TABS: SectionTab[] = [
  { href: '/admin/ship', label: 'Queue' },
  { href: '/admin/queue', label: 'Approvals' },
  { href: '/admin/creative', label: 'Creative help' },
  { href: '/admin/house', label: 'House slides' },
  { href: '/admin/trivia', label: 'Trivia' },
]

// More — real pages, just not daily ones. Money leads because it is the only one
// here you ever open in a hurry.
export const MORE_TABS: SectionTab[] = [
  { href: '/admin/more', label: 'All pages' },
  { href: '/admin/money', label: 'Billing' },
  { href: '/admin/settings', label: 'Business settings' },
  { href: '/admin/pricing', label: 'Pricing & packages' },
  { href: '/admin/messages', label: 'Templates' },
  { href: '/admin/email', label: 'Emails' },
  { href: '/admin/account', label: 'Account' },
]
