-- Loop Network — host-stated typical customers per day.
--
-- "Reach" was a monthly foot_traffic_estimate divided by 30 — a guess. Hosts
-- know their own typical daily customer count, so we now ask for it at
-- registration and use it directly for reach (per-day = this number). When null,
-- analytics fall back to foot_traffic_estimate / 30 (see lib/analytics.ts).
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

alter table venues
  add column if not exists median_daily_customers int;

comment on column venues.median_daily_customers is
  'Host-stated typical customers per day; drives reach directly when set.';
