import type { Metadata } from 'next'
import { GA_ID, GA_EVENTS } from '@/lib/gtag'

export const metadata: Metadata = {
  title: 'Analytics Reference | Loop Network',
  description: 'The GA4 measurement plan for Loop Network — every tracked event, its trigger, and its parameters.',
}

// ──────────────────────────────────────────────────────────────────────────
// GA4 MEASUREMENT PLAN — human-readable reference for review.
//
// This page documents exactly what the site sends to Google Analytics 4 and
// where it is instrumented, so the tracking can be reviewed without reading the
// code. Keep it in sync when events change:
//   • event helpers + names ....... lib/gtag.ts
//   • gtag.js loader + page_view .. components/analytics/GoogleAnalytics.tsx
//   • navigation_click delegation . components/analytics/NavClickTracker.tsx
//   • scroll_depth ................ components/analytics/ScrollDepth.tsx
// ──────────────────────────────────────────────────────────────────────────

type Param = { key: string; desc: string }
type EventDoc = {
  name: string
  summary: string
  triggers: string[]
  sources: string[]
  params: Param[]
}

const EVENTS: EventDoc[] = [
  {
    name: GA_EVENTS.pageView,
    summary: 'A page was viewed, including client-side (SPA) route changes.',
    triggers: [
      'Initial page load (sent once by the gtag config).',
      'Every App Router navigation to a new path.',
    ],
    sources: ['components/analytics/GoogleAnalytics.tsx'],
    params: [
      { key: 'page_path', desc: 'Pathname of the page (e.g. /advertiser/browse).' },
      { key: 'page_location', desc: 'Full URL including query string.' },
      { key: 'page_title', desc: 'document.title at view time.' },
    ],
  },
  {
    name: GA_EVENTS.navigationClick,
    summary: 'A visitor clicked a link inside a navigation region.',
    triggers: [
      'Any <a> click inside a nav tagged data-ga-nav: the app bottom tab bar, the admin sidebar, the app header, and the marketing header/footer.',
      'Selecting a result in the admin ⌘K command palette.',
    ],
    sources: [
      'components/analytics/NavClickTracker.tsx (delegated)',
      'components/app/BottomNav.tsx, components/admin/AdminNav.tsx, components/app/AppShell.tsx, app/page.tsx (data-ga-nav markers)',
      'components/admin/CommandPalette.tsx (result selection)',
    ],
    params: [
      { key: 'link_text', desc: 'Visible text of the link (trimmed, ≤100 chars).' },
      { key: 'link_url', desc: 'href the link points to.' },
      { key: 'nav_region', desc: 'Which nav it lives in: app_bottom_nav, admin_sidebar, app_header, marketing_header, marketing_footer, command_palette_result.' },
    ],
  },
  {
    name: GA_EVENTS.copyToClipboard,
    summary: 'A code/value sample was copied to the clipboard.',
    triggers: [
      'Clicking the copy button on a CopyField (screen/kiosk links, pairing codes, device IDs).',
    ],
    sources: ['components/app/CopyField.tsx'],
    params: [
      { key: 'content_type', desc: 'Always "code_sample".' },
      { key: 'copy_label', desc: 'The button label (e.g. "Copy screen link").' },
      { key: 'copy_context', desc: 'Where the field lives (e.g. screen_pairing, code_sample).' },
    ],
  },
  {
    name: GA_EVENTS.search,
    summary: 'A visitor searched a listing (GA4 recommended search event).',
    triggers: [
      'Admin list search settling (venues, advertisers) after a debounce.',
      'Admin ⌘K command palette query resolving.',
      'The advertiser browse business-type search box settling.',
    ],
    sources: [
      'components/admin/ListSearch.tsx',
      'components/admin/CommandPalette.tsx',
      'app/advertiser/browse/BrowseClient.tsx',
    ],
    params: [
      { key: 'search_term', desc: 'The query text (trimmed, ≤100 chars). Empty queries are not sent.' },
      { key: 'search_context', desc: 'Which listing was searched: venues, advertisers, command_palette, advertiser_browse_category.' },
    ],
  },
  {
    name: GA_EVENTS.filterSelect,
    summary: 'A visitor applied a filter to a listing.',
    triggers: [
      'Choosing a status filter on an admin list.',
      'Picking a business category on the advertiser browse flow.',
    ],
    sources: ['components/admin/ListSearch.tsx', 'app/advertiser/browse/BrowseClient.tsx'],
    params: [
      { key: 'filter_type', desc: 'The dimension filtered: status, category.' },
      { key: 'filter_value', desc: 'The chosen value (e.g. active, "Sports Bar", all).' },
      { key: 'filter_context', desc: 'Which listing the filter belongs to.' },
    ],
  },
  {
    name: GA_EVENTS.scrollDepth,
    summary: 'A visitor scrolled past a depth milestone on a long page.',
    triggers: [
      'Reaching 25%, 50%, 75%, or 100% of a long page. Each milestone fires at most once per page view; short (non-scrollable) pages fire nothing.',
    ],
    sources: [
      'components/analytics/ScrollDepth.tsx',
      'Mounted on: app/page.tsx (marketing_home), app/changelog, app/terms, app/privacy',
    ],
    params: [
      { key: 'percent_scrolled', desc: 'One of 25, 50, 75, 100.' },
      { key: 'page_id', desc: 'Which page: marketing_home, changelog, terms, privacy.' },
    ],
  },
]

const CONVENTIONS = [
  'Event and parameter names are snake_case, ≤40 characters, and start with a letter.',
  "GA4's recommended names are reused where one exists: search + search_term, link_text, link_url, percent_scrolled, page_path.",
  'Custom names (navigation_click, copy_to_clipboard, filter_select, scroll_depth) are descriptive verbs/nouns that read cleanly in GA4 reports.',
  'All tracking is additive and fails safe: with no NEXT_PUBLIC_GA_ID, gtag.js never loads and every helper is a silent no-op.',
]

function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'active' }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ' +
        (tone === 'active'
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border bg-muted/40 text-muted-foreground')
      }
    >
      {children}
    </span>
  )
}

export default function AnalyticsReferencePage() {
  const configured = !!GA_ID

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <header>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Measurement plan
        </p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground">
          Analytics <span className="text-gold-metallic">Reference</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Every event Loop Network sends to Google Analytics 4, what triggers it, and the
          parameters it carries. This is the review surface for the site&apos;s tracking — it stays
          in sync with the instrumentation in <code className="font-mono text-xs">lib/gtag.ts</code>.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Pill tone={configured ? 'active' : 'muted'}>
            {configured ? 'GA4 configured' : 'GA4 not configured (tracking dormant)'}
          </Pill>
          <Pill>{EVENTS.length} events</Pill>
        </div>
      </header>

      {/* How it works */}
      <section className="mt-10 rounded-xl border border-border bg-card/30 p-5">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          How it works
        </h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            Set <code className="font-mono text-xs text-foreground">NEXT_PUBLIC_GA_ID</code> to your
            GA4 Measurement ID (<code className="font-mono text-xs">G-XXXXXXXXXX</code>). Until then,
            gtag.js never loads and nothing is tracked.
          </li>
          <li>
            gtag.js is loaded once from the root layout. Client navigations emit their own{' '}
            <code className="font-mono text-xs text-foreground">page_view</code> (the initial config
            uses <code className="font-mono text-xs">send_page_view:false</code> so views aren&apos;t
            double-counted).
          </li>
          <li>
            Navigation clicks are captured by one delegated listener; the individual nav components
            only tag their container with{' '}
            <code className="font-mono text-xs text-foreground">data-ga-nav</code>. No existing
            behavior changes.
          </li>
        </ul>
      </section>

      {/* Event catalog */}
      <section className="mt-10 space-y-4">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Events
        </h2>
        {EVENTS.map((e) => (
          <article key={e.name} className="rounded-xl border border-border bg-card/30 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="font-mono text-sm font-semibold text-primary">{e.name}</code>
            </div>
            <p className="mt-2 text-sm text-foreground">{e.summary}</p>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fires when
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {e.triggers.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Parameters
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <tbody>
                  {e.params.map((p) => (
                    <tr key={p.key} className="border-t border-border align-top">
                      <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-foreground">
                        {p.key}
                      </td>
                      <td className="py-2 text-muted-foreground">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Instrumented in
            </p>
            <ul className="mt-1 space-y-0.5">
              {e.sources.map((s, i) => (
                <li key={i} className="font-mono text-xs text-muted-foreground">
                  {s}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      {/* Conventions */}
      <section className="mt-10 rounded-xl border border-border bg-card/30 p-5">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Naming conventions
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {CONVENTIONS.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-xs text-muted-foreground">
        Loop Network — GA4 measurement plan. Update this page whenever the event schema in{' '}
        <code className="font-mono">lib/gtag.ts</code> changes.
      </p>
    </main>
  )
}
