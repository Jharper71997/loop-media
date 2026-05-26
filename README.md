# Loop Media

Local indoor digital advertising network. TVs in high-dwell venues play a continuous loop of
15-second ads from local businesses; advertisers buy *reach* across a city's screens — "Facebook
Ads, but physical."

Three roles share the app — **Admin**, **Advertiser**, **Host Venue** — plus a standalone
**TV Display** endpoint for Firestick / Roku / Android TV / smart-TV browsers.

## Stack

- Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui
- Supabase (auth + Postgres + storage) via `@supabase/ssr`
- Stripe (monthly subscriptions)
- Leaflet + OpenStreetMap (advertiser map view)

## Setup

1. `cp .env.example .env.local` and fill in Supabase + Stripe keys.
2. Create a Supabase project, then apply the SQL migrations **in order**:
   - `supabase/migrations/0001_init.sql` — tables, enums, indexes, triggers
   - `supabase/migrations/0002_rls.sql` — row-level security policies
   - `supabase/migrations/0003_seed.sql` — demo territory, categories, packages, venues, TVs

   Apply via the Supabase SQL editor (paste each file) **or** the Supabase CLI:
   ```bash
   supabase link --project-ref <ref>
   supabase db push        # applies everything in supabase/migrations
   ```
3. Create two Storage buckets: `creatives` (advertiser ad files) and `host-promos`.
4. Sign up through the app, then promote yourself to admin (see the bottom of `0003_seed.sql`).
5. `npm run dev`.

## Data model

See `supabase/migrations/0001_init.sql` for the source of truth and `lib/db.types.ts` for the
TypeScript mirror. Core tables: `territories`, `profiles`, `categories`, `category_caps`, `venues`,
`tvs`, `ads`, `creative_requests`, `packages`, `package_territory_prices`, `campaigns`,
`subscriptions`, `ad_placements`, `qr_scans`, `filler_content`.

### Key model decisions

- **Exclusivity = exact category match** — an ad is blocked from a screen only when the advertiser's
  category equals the venue's own category.
- **Goal-based placement** — advertisers set a foot-traffic / impression goal; the engine fills the
  highest-traffic eligible screens until the goal (or the package screen cap) is met.
- **Pricing supports both global and per-territory** — `packages.base_price_cents` with an optional
  `package_territory_prices` override per city.
- **Multi-territory** — a Holdings parent territory sits above child city territories.
