-- Exactly-once ledger for the monthly HOST recap email ("what your screen did for
-- you"). Mirrors report_log (0018), which does the same for advertiser reports.
-- One row per host per period is the exactly-once guard, so a retry or a manual
-- run never double-sends. The reports cron self-gates to the 1st of the month and
-- folds the host recap into the same daily run (Vercel Hobby allows only daily
-- crons, so we do NOT add a separate schedule).

create table if not exists public.host_report_log (
  id            uuid primary key default gen_random_uuid(),
  host_user_id  uuid not null references public.profiles(id) on delete cascade,
  period_month  text not null,                 -- 'YYYY-MM'
  sent_to       text,                          -- host email at send time
  status        text not null default 'sent',  -- 'sent' | 'skipped' | 'error'
  detail        text,                          -- provider id, skip reason, or error text
  created_at    timestamptz not null default now()
);

-- One ledger row per host per month (the exactly-once guard the cron upserts on).
create unique index if not exists host_report_log_host_period_key
  on public.host_report_log (host_user_id, period_month);

create index if not exists host_report_log_period_idx
  on public.host_report_log (period_month);

-- Service-role only (the cron writes it). No policies => no anon/authenticated
-- access; the service-role admin client bypasses RLS.
alter table public.host_report_log enable row level security;
