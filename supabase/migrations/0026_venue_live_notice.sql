-- Exactly-once log for the "a new screen just went live near you" advertiser
-- email. One row per venue we've already announced, so a daily cron never
-- double-sends. Service-role only (RLS on, no policies).

create table if not exists public.venue_live_notice_log (
  venue_id    uuid primary key references public.venues(id) on delete cascade,
  notified_at timestamptz not null default now(),
  sent_count  int not null default 0
);

alter table public.venue_live_notice_log enable row level security;
-- Intentionally no policies: service role only.

-- Backfill: any venue whose screen has ALREADY checked in is not "new" — seed
-- it as announced so the first cron run only emails about screens that go live
-- AFTER this migration, never the ones already up.
insert into public.venue_live_notice_log (venue_id)
select distinct venue_id
from public.tvs
where last_heartbeat_at is not null
on conflict (venue_id) do nothing;
