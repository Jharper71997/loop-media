-- 0018_monthly_reports.sql
-- Idempotency ledger for the monthly ROI report email cron.
--
-- The reports cron runs DAILY (Vercel Hobby allows only daily crons) and
-- self-gates to the 1st of the month. report_log makes the send exactly-once
-- per (campaign, period_month): the cron inserts a row before/at send and skips
-- any campaign already logged for that period, so a re-run, a retry, or a manual
-- ?force= trigger never double-emails an advertiser.
--
-- Re-runnable: guarded with IF NOT EXISTS throughout.

create table if not exists public.report_log (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  period_month  text not null,            -- 'YYYY-MM'
  sent_to       text,                     -- advertiser email at send time
  status        text not null default 'sent', -- 'sent' | 'skipped' | 'error'
  detail        text,                     -- provider id, skip reason, or error text
  created_at    timestamptz not null default now()
);

-- One ledger row per campaign per month (the exactly-once guard).
create unique index if not exists report_log_campaign_period_key
  on public.report_log (campaign_id, period_month);

create index if not exists report_log_period_idx
  on public.report_log (period_month);

-- Server-only table: written by the cron via the service-role client, never by
-- end users. Enable RLS with no policies so anon/authenticated roles get nothing
-- (service role bypasses RLS).
alter table public.report_log enable row level security;
