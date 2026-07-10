// Google Analytics 4 (gtag.js) event tracking for Loop Network.
//
// Everything here is a NO-OP unless NEXT_PUBLIC_GA_ID is set AND gtag.js has
// actually loaded (see components/analytics/GoogleAnalytics.tsx). That keeps
// analytics strictly additive: no measurement ID → the site behaves exactly as
// before, and a blocked/failed script can never throw into product code.
//
// Naming follows GA4 conventions: snake_case event + parameter names, ≤40 chars,
// starting with a letter, and GA4's recommended parameter names (search_term,
// link_text, link_url, percent_scrolled) wherever one exists. The full
// measurement plan is documented at /analytics-reference.

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? ''

// Every event this app emits, in one place so the reference page and the call
// sites can't drift apart. Values are the literal GA4 event names.
export const GA_EVENTS = {
  pageView: 'page_view',
  navigationClick: 'navigation_click',
  copyToClipboard: 'copy_to_clipboard',
  search: 'search',
  filterSelect: 'filter_select',
  scrollDepth: 'scroll_depth',
} as const

export type GaEventName = (typeof GA_EVENTS)[keyof typeof GA_EVENTS]

type GaParams = Record<string, string | number | boolean | undefined>

declare global {
  interface Window {
    gtag?: (command: string, ...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

function enabled(): boolean {
  return !!GA_ID && typeof window !== 'undefined' && typeof window.gtag === 'function'
}

// Low-level send. Undefined params are dropped so GA4 never records empty keys.
export function gaEvent(name: GaEventName, params: GaParams = {}): void {
  if (!enabled()) return
  const clean: GaParams = {}
  for (const [k, v] of Object.entries(params)) if (v !== undefined) clean[k] = v
  window.gtag!('event', name, clean)
}

// A manual SPA page_view. App Router client navigations don't reload gtag.js, so
// GoogleAnalytics fires this on every route change (initial config uses
// send_page_view:false so these are the single source of page views).
export function gaPageView(path: string): void {
  if (!enabled()) return
  window.gtag!('event', GA_EVENTS.pageView, {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  })
}

// ---- Typed, descriptive helpers used across the app -------------------------

// A click on any navigation element (tab bars, sidebars, header/footer nav).
export function trackNavClick(args: {
  linkText: string
  linkUrl: string
  navRegion: string // where the nav lives, e.g. 'app_bottom_nav', 'admin_sidebar'
}): void {
  gaEvent(GA_EVENTS.navigationClick, {
    link_text: args.linkText.slice(0, 100),
    link_url: args.linkUrl,
    nav_region: args.navRegion,
  })
}

// A copy-to-clipboard on a code/value sample (kiosk URLs, pairing codes, IDs).
export function trackCopy(args: { label: string; context: string }): void {
  gaEvent(GA_EVENTS.copyToClipboard, {
    content_type: 'code_sample',
    copy_label: args.label,
    copy_context: args.context,
  })
}

// A search-box query on a listing. Uses GA4's recommended `search` event +
// `search_term` param so it lights up GA's built-in search reports.
export function trackSearch(args: { searchTerm: string; context: string }): void {
  const term = args.searchTerm.trim()
  if (!term) return
  gaEvent(GA_EVENTS.search, {
    search_term: term.slice(0, 100),
    search_context: args.context,
  })
}

// A filter / dropdown selection on a listing (status, category, …).
export function trackFilter(args: {
  filterType: string
  filterValue: string
  context: string
}): void {
  gaEvent(GA_EVENTS.filterSelect, {
    filter_type: args.filterType,
    filter_value: args.filterValue,
    filter_context: args.context,
  })
}

// A scroll-depth milestone on a long page (25 / 50 / 75 / 100).
export function trackScrollDepth(args: { percent: 25 | 50 | 75 | 100; page: string }): void {
  gaEvent(GA_EVENTS.scrollDepth, {
    percent_scrolled: args.percent,
    page_id: args.page,
  })
}
