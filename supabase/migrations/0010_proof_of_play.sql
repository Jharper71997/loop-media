-- Loop Network — proof of play: real ad-play counts + TV uptime.
--
-- Until now impressions were ESTIMATED from venue foot traffic. This records
-- what actually happened: every time a screen shows an ad it logs an ad_plays
-- row, and every heartbeat adds to that screen's uptime for the day. Powers the
-- "on today", "times shown today / this month" metrics.
--
-- Append-only and idempotent.

-- ---- ad plays ---------------------------------------------------------------
create table if not exists ad_plays (
  id        uuid primary key default gen_random_uuid(),
  ad_id     uuid not null references ads(id) on delete cascade,
  tv_id     uuid references tvs(id) on delete set null,
  played_at timestamptz not null default now()
);
create index if not exists idx_ad_plays_ad on ad_plays(ad_id, played_at);
create index if not exists idx_ad_plays_tv on ad_plays(tv_id, played_at);

alter table ad_plays enable row level security;
do $$ begin
  create policy ad_plays_admin on ad_plays for select to authenticated using (is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy ad_plays_owner on ad_plays for select to authenticated
    using (ad_id in (select id from ads where owner_user_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- ---- per-screen uptime per day ----------------------------------------------
create table if not exists tv_uptime_days (
  tv_id   uuid not null references tvs(id) on delete cascade,
  day     date not null,
  seconds int  not null default 0,
  primary key (tv_id, day)
);
alter table tv_uptime_days enable row level security;
do $$ begin
  create policy tv_uptime_admin on tv_uptime_days for select to authenticated using (is_admin());
exception when duplicate_object then null; end $$;

-- Atomic increment used by the heartbeat endpoint (service role).
create or replace function bump_tv_uptime(p_tv uuid, p_secs int)
returns void language sql security definer set search_path = public as $$
  insert into tv_uptime_days (tv_id, day, seconds)
  values (p_tv, current_date, greatest(p_secs, 0))
  on conflict (tv_id, day)
    do update set seconds = tv_uptime_days.seconds + greatest(excluded.seconds, 0);
$$;
