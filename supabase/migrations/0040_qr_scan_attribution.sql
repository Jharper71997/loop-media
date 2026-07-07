-- Loop Network — QR scan attribution, dedup + bot flagging.
--
-- Every GET on /r/<ad_id> logged a raw scan: no venue, no bot filter, no dedup —
-- yet the monthly report calls each "a real person." This denormalizes the venue
-- onto each scan (for per-venue-type segmentation) and adds a bot flag so counted
-- metrics can exclude crawlers/link-preview fetchers. Dedup (same person + same ad
-- within ~30 min) is enforced in app code at insert time (see app/r/[code]/route.ts).
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

alter table qr_scans add column if not exists venue_id   uuid references venues(id) on delete set null;
alter table qr_scans add column if not exists venue_type text;
alter table qr_scans add column if not exists is_bot     boolean not null default false;

-- Supports the 30-minute dedup pre-check (ad + ip within a recent window) and the
-- is_bot=false filter that counted metrics apply.
create index if not exists qr_scans_dedup on qr_scans (ad_id, ip_hash, scanned_at);
create index if not exists qr_scans_venue on qr_scans (venue_id);
