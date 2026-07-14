-- Advertiser "free week" credit. An admin can grant a free week to an advertiser
-- even before they've started a campaign; when they build their first campaign,
-- checkout is skipped and it runs free for 7 days (comp_until, auto-stopped by the
-- place cron), consuming the credit. true = one unused free week available.
-- Idempotent, safe to re-run.
alter table public.profiles
  add column if not exists free_week_credit boolean not null default false;
