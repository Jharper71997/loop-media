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
