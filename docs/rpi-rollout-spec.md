# Loop Network — Raspberry Pi Player Rollout & App Changes (Build Spec)

> Self-contained handoff. Assumes the `loop-media` repo but NOT any prior chat.

## 0. Context
Loop Network = indoor TV ad network. Host venues (bars, shops) show a rotating ad reel on their TVs; advertisers buy **category-exclusive** slots per screen. Repo: `loop-media` — Next.js 16 (App Router), Supabase, Stripe, Leaflet, shadcn **Base UI variant (use `render`, not `asChild`)**. The repo has its own `CLAUDE.md` — read it first. Still on temp domain `loop-network-one.vercel.app`.

**Goal:** move the venue playback device to a **Raspberry Pi in Chromium kiosk** (fleet-managed via balenaCloud), and build the app changes that support zero-touch provisioning + a public **"coming soon → live"** screen lifecycle.

## 1. What ALREADY exists — do NOT rebuild
`/tv` is already a complete, device-agnostic signage client:
- `app/tv/page.tsx` + `app/tv/TvPlayer.tsx` — fullscreen kiosk player.
- Pairing by code → `app/api/tv/pair/route.ts` (anonymous, service-role; one-time code, consumed on use; never echoes a bound `device_id` — per the 2026-06-14 security audit).
- Loop manifest → `app/api/tv/loop/route.ts` (ordered ad placements + filler + venue weather; player resyncs every 45s).
- Heartbeat every 30s → `app/api/tv/heartbeat/route.ts`; proof-of-play per ad → `app/api/tv/play/route.ts`.
- Offline playback: `public/tv-sw.js` + localStorage cache; Wake Lock keeps the screen awake.
- **Liveness is DERIVED, not stored:** `isTvLive(last_heartbeat_at)` in `lib/format.ts` (`<95s` = live). `tvs.status` enum is unreliable (nothing flips it back to offline) — trust the heartbeat clock.

A Raspberry Pi running Chromium `--kiosk` pointed at `/tv` works against all of this with **zero** code changes.

## 2. Already BUILT (not yet deployed) — verify + ship
`app/tv/TvPlayer.tsx` `Pairing` component now reads `?code=LM-XXXXX` from the kiosk URL and **self-pairs on first boot**, so a provisioned screen needs no human code entry. Falls back to the manual form if the code is already consumed. Lint + `tsc --noEmit` are clean.
- **Task:** review, commit, deploy.
- **Gotcha:** the kiosk MUST use a persistent Chromium profile, or localStorage (`device_id` + offline cache) is wiped on reboot and re-pair fails against the consumed one-time code.

## 3. Build tasks

### Task A — "Coming soon → live" screen lifecycle (headline feature)
A venue is onboarded BEFORE its Pi ships. On the advertiser buy-map it shows as a **red "Coming soon" dot, not buyable**. When the host plugs in the Pi and it heartbeats, the venue flips **green and buyable automatically** — no admin step.

Derive **live** = venue has ≥1 TV with `isTvLive(last_heartbeat_at)`. No new enum needed: `venue_status` (`active`/`inactive`) stays the show/hide-from-map gate; liveness is the green flip.

Changes:
- `app/advertiser/browse/page.tsx`: add `last_heartbeat_at` to the `tvs(...)` select; compute `live = tvs.some(t => isTvLive(t.last_heartbeat_at))`; set `comingSoon = !live` on each `BrowseVenue`. Keep coming-soon venues in the list — they still must pass `isVenueListable` (`lib/venue.ts`: needs `foot_traffic_estimate > 0` + lat/lng to place a dot).
- `app/advertiser/browse/BrowseClient.tsx`: add `comingSoon: boolean` to `BrowseVenue`; in `toggle()` block adding a coming-soon venue to the cart (same as `categoryFull`).
- `app/advertiser/browse/MapView.tsx` + `components/app/VenueCard.tsx`: render coming-soon with a distinct red/grey marker + "Coming soon" badge; replace the add action with the existing **notify/waitlist** flow (`joinWaitlist`/`leaveWaitlist`, already wired in `BrowseClient`).
- **Acceptance:** a venue with no live TV is red, not addable, can "notify me"; once its Pi heartbeats (`<95s`), a page refresh shows it green + addable. (Buy-map is a server component; liveness is as-of page load — optionally add a periodic refresh like `AutoRefresh`.)

### Task B — Collect venue WiFi for provisioning
New migration `supabase/migrations/0023_venue_network.sql` on `venues`: `wifi_ssid text`, `wifi_password text`, `network_type text default 'wifi'` (`'wifi'|'ethernet'|'cellular'`), `network_note text`.
- `app/host/register/RegisterVenueForm.tsx`: add a "How your screen gets online" section — network type, and when WiFi, SSID + password, with one line of reassurance ("only used to pre-configure the screen we send you").
- Existing venues: same fields on a venue-edit path + a nudge on `app/host/page.tsx` where `wifi_ssid` is empty.
- `app/(admin)/admin/venues/[id]` (or `admin/tvs/[id]`): show a copy-paste **balena provisioning block** per device — `KIOSK_URL=…/tv?code=<pairing_code>`, `WIFI_SSID`, `WIFI_PASSWORD`.
- **Security:** treat `wifi_password` as a secret — never SELECT it in any host/anon query, read it only via the service-role admin client (`lib/supabase/admin.ts`), enforce with RLS; optional `pgcrypto` at rest.

### Task C — Update host setup copy (the process changed)
`app/host/TvSetupSteps.tsx` currently tells hosts to "open a browser on your TV and enter this code." With a pre-provisioned Pi they don't. Rewrite to the Pi flow ("plug in the Loop Network box we sent — HDMI + power — it comes online on its own"). Keep the manual-code version for any non-Pi smart-TV hosts.

### Task D — (optional) CEC schedule from business hours
The Pi powers the TV on/off via HDMI-CEC on a cron. Single source of truth: expose each venue's hours (migration `0020_business_hours.sql`) via a small endpoint the Pi reads, so changing hours in the app changes when the TV powers on (otherwise hours live in two places).

## 4. The deployment this serves (so the dev understands the "why")
- **One identical balenaOS SD image per Pi**; the only per-venue difference is the pairing code, set as a per-device balena env var that builds the kiosk URL `…/tv?code=LM-XXXXX`.
- Pi 5 (or Pi 4 2GB), Chromium `--kiosk`, persistent profile, screen-blanking off (`raspi-config`), CEC cron for on/off (`cec-client`).
- balenaCloud dashboard = uptime monitoring + remote reboot + OTA. Proof-of-play + heartbeat already feed ROI reports (`lib/reports.ts`, `lib/uptime.ts`).

## 5. Conventions / gotchas
- Read `loop-media/CLAUDE.md`. shadcn Base UI: `render`, not `asChild`.
- Anonymous device routes (`/api/tv/*`) use the service-role admin client (`lib/supabase/admin.ts`) and bypass RLS — keep that boundary tight (the 2026-06-14 audit fixed a `device_id` leak here).
- Liveness: always derive from `last_heartbeat_at`; never trust `tvs.status`.
- Supabase migrations are hand-applied — call out any new migration explicitly in the handoff.
- Verify every change with `npm run lint` + `npx tsc --noEmit` before declaring done.
