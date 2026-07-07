-- Loop Network — host offline-screen alert log.
--
-- The platform detects an offline screen in ~95s but never tells the host. The
-- offline-alerts job (app/api/cron/offline-alerts) finds screens that have gone
-- stale DURING the venue's open hours and emails the host. This log records each
-- send so a screen that stays down doesn't email the host on every run — one alert
-- per screen per cooldown window.
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

create table if not exists tv_alerts (
  id         uuid primary key default gen_random_uuid(),
  tv_id      uuid not null references tvs(id) on delete cascade,
  kind       text not null default 'offline',
  sent_to    text,
  created_at timestamptz not null default now()
);

create index if not exists tv_alerts_recent on tv_alerts (tv_id, created_at desc);

alter table tv_alerts enable row level security;

do $$ begin
  create policy tv_alerts_admin on tv_alerts for select to authenticated
    using (is_admin());
exception when duplicate_object then null; end $$;
