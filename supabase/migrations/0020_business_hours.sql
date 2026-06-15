-- 0020_business_hours.sql
-- Business hours per venue, the denominator for the uptime SLA.
--
-- We already record real on-time per screen per day in tv_uptime_days.seconds
-- (heartbeat -> bump_tv_uptime, +30s/beat). To turn that into an uptime %, we
-- need EXPECTED on-time: the hours the venue is actually open. We guarantee ~80%
-- of the host's business hours (Susan call, 2026-06-14), not 24/7, so a closed
-- venue at 3am is not a breach.
--
-- Simple model: one open/close window plus the weekdays the venue operates.
-- business_days uses 0=Sunday .. 6=Saturday. Times are local wall-clock 'HH:MM'
-- (the SLA math is coarse and ignores per-venue timezone offsets on the day
-- boundary, which is fine for a daily uptime percentage).
--
-- Re-runnable.

alter table public.venues
  add column if not exists business_open  text   not null default '10:00',
  add column if not exists business_close text   not null default '22:00',
  add column if not exists business_days  int[]  not null default '{0,1,2,3,4,5,6}';

-- Let advertisers READ uptime for the screens their ads run on (the SLA is a
-- promise to THEM). Writes still come only from the heartbeat (service role).
do $$ begin
  create policy tv_uptime_advertiser on public.tv_uptime_days for select to authenticated
    using (
      tv_id in (
        select p.tv_id
        from ad_placements p
        join ads a on a.id = p.ad_id
        where a.owner_user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;
