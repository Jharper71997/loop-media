-- Loop Network: apply migrations 0018-0021 (2026-06-14)
-- Paste this whole file into Supabase SQL Editor and click Run.
-- Safe to re-run (every statement is guarded).

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


-- 0019_ad_changes.sql
-- Commercial model for creative changes (Susan call, 2026-06-14):
--   * $10 fee per creative change on a live campaign.
--   * "Unlimited changes" membership: while active, changes are free.
--   * 30-day notice is a policy surfaced in the UI (not DB-enforced).
--
-- Two tables:
--   ad_change_requests  — one row per requested creative swap. A member's (or
--     demo) change is applied immediately (status 'applied'). A paid change is
--     staged (status 'pending_payment') with the uploaded creative held here, and
--     the Stripe webhook applies it to the ad once the $10 is paid.
--   memberships         — an advertiser's recurring add-on subscriptions (today
--     just 'unlimited_changes'), tracked separately from campaign subscriptions
--     so the webhook can tell the two kinds of Stripe subscription apart.
--
-- Re-runnable: guarded with IF NOT EXISTS throughout.

create table if not exists public.ad_change_requests (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  ad_id           uuid not null references public.ads(id) on delete cascade,
  advertiser_id   uuid not null references public.profiles(id) on delete cascade,
  creative_url    text not null,
  creative_type   text not null default 'image', -- 'image' | 'video'
  fee_cents       integer not null default 0,
  -- 'pending_payment' (awaiting $10), 'applied' (creative pushed to ad),
  -- 'waived' (free via membership/demo), 'canceled'
  status          text not null default 'pending_payment',
  stripe_session_id text,
  created_at      timestamptz not null default now(),
  applied_at      timestamptz
);

create index if not exists ad_change_requests_campaign_idx
  on public.ad_change_requests (campaign_id);
create index if not exists ad_change_requests_session_idx
  on public.ad_change_requests (stripe_session_id);

create table if not exists public.memberships (
  id                     uuid primary key default gen_random_uuid(),
  advertiser_id          uuid not null references public.profiles(id) on delete cascade,
  kind                   text not null default 'unlimited_changes',
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  -- reuse the same status vocabulary as subscriptions
  status                 text not null default 'incomplete',
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists memberships_advertiser_idx
  on public.memberships (advertiser_id, kind);

-- RLS: advertisers may READ their own change requests + memberships (so the UI
-- can show status). All WRITES go through the service-role client (server
-- actions + webhook), which bypasses RLS.
alter table public.ad_change_requests enable row level security;
alter table public.memberships enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ad_change_requests'
      and policyname = 'ad_change_requests_owner_read'
  ) then
    create policy ad_change_requests_owner_read on public.ad_change_requests
      for select using (advertiser_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'memberships'
      and policyname = 'memberships_owner_read'
  ) then
    create policy memberships_owner_read on public.memberships
      for select using (advertiser_id = auth.uid());
  end if;
end $$;


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


-- ============================================================
-- 0021_creative_queue.sql
-- Creative-help admin queue.
--
-- Advertisers can ask us to make their ad for them (creative_requests, seeded
-- from the campaign builder's "creative_help_brief"). They could already file
-- one; admins could only read them. This adds the columns + write policy the
-- admin queue needs to actually work the requests: record who handled it, a
-- note back to the advertiser, and a last-touched timestamp.
-- ============================================================

alter table creative_requests
  add column if not exists admin_note text,
  add column if not exists handled_by uuid references profiles(id),
  add column if not exists updated_at timestamptz not null default now();

-- Let admins move a request through open -> in_progress -> done and save a note.
-- creq_admin (select) already exists; this adds update/delete for admins.
drop policy if exists creq_admin_write on creative_requests;
create policy creq_admin_write on creative_requests for update to authenticated
  using (is_admin()) with check (is_admin());


