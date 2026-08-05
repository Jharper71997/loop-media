import type { LucideIcon } from 'lucide-react'
import { HelpCircle, MonitorPlay, MapPin, Sparkles, Tag, Store, Newspaper } from 'lucide-react'

// One source of truth for the PUBLIC site's tabs. The marketing pages used to
// carry no navigation at all — every page rendered its own bare wordmark and a
// lone "Log in", so a visitor who landed on /directory or /preview had no way to
// see the rest of the site or get back. Both the desktop tab row and the mobile
// sidebar drawer read this list, so a tab is added in exactly one place.
export type SiteTab = {
  href: string
  label: string
  icon: LucideIcon
  /** One-line explainer — shown in the sidebar drawer, where there's room for it. */
  blurb: string
  /** Anchors on the home page: highlight only while actually on "/". */
  anchor?: boolean
}

export const SITE_TABS: SiteTab[] = [
  {
    href: '/#how',
    label: 'How it works',
    icon: HelpCircle,
    blurb: 'Three steps from picking screens to going live.',
    anchor: true,
  },
  {
    href: '/playing',
    label: 'On the screens',
    icon: MonitorPlay,
    blurb: 'The real ads running on Loop TVs right now.',
  },
  {
    href: '/directory',
    label: 'Where the screens are',
    icon: MapPin,
    blurb: 'Every local business hosting a Loop screen.',
  },
  {
    href: '/preview',
    label: 'Preview your ad',
    icon: Sparkles,
    blurb: 'Drop in a photo and see it on a TV. No sign-up.',
  },
  {
    href: '/#pricing',
    label: 'Pricing',
    icon: Tag,
    blurb: 'Published rates. No media kit, no sales call.',
    anchor: true,
  },
]

// Secondary links — sidebar drawer + footer only, never the desktop tab row.
export const SITE_SECONDARY: SiteTab[] = [
  {
    href: '/signup/host',
    label: 'Host a screen',
    icon: Store,
    blurb: 'Free TV, free entertainment, free promo slots.',
  },
  {
    href: '/changelog',
    label: "What's new",
    icon: Newspaper,
    blurb: 'Recent updates to the platform.',
  },
]
