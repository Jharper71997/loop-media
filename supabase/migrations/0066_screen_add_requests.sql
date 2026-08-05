-- 0066_screen_add_requests.sql
-- Adding a screen to a LIVE campaign now goes through Checkout instead of a
-- silent off-session charge on the card we have on file.
--
-- Why a staging table: the screens must not exist until the money clears. The
-- request is written here with status 'pending_payment', the advertiser is sent
-- to Stripe Checkout, and only the webhook (on checkout.session.completed)
-- writes the campaign_targets, moves the subscription onto the new monthly
-- total, and places the ad. Abandon or decline = the row stays pending and the
-- campaign is untouched. This mirrors ad_change_requests (0019).
--
-- amount_cents is ONE MONTH OF THE INCREASE (new monthly total - current), not a
-- flat per-screen fee and not a date-prorated amount. Screen pricing is tiered
-- and non-linear (per-screen rate drops with volume), so on some steps the
-- increase is genuinely $0 — e.g. 2 screens and 3 screens can cost the same. A
-- $0 request is applied immediately as 'waived' and never reaches Checkout.
--
-- Re-runnable: guarded with IF NOT EXISTS throughout.

create table if not exists public.screen_add_requests (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns(id) on delete cascade,
  advertiser_id     uuid not null references public.profiles(id) on delete cascade,
  -- the net-new venues this request adds (already validated when staged)
  venue_ids         uuid[] not null,
  -- charged up front at Checkout: one month of the increase, floored at 0
  amount_cents      integer not null default 0,
  -- what campaigns.monthly_total_cents becomes once this is applied
  new_monthly_cents integer not null,
  -- 'pending_payment' (awaiting Checkout), 'applied' (screens live),
  -- 'waived' (no increase to charge / demo), 'canceled'
  status            text not null default 'pending_payment',
  stripe_session_id text,
  created_at        timestamptz not null default now(),
  applied_at        timestamptz
);

create index if not exists screen_add_requests_campaign_idx
  on public.screen_add_requests (campaign_id);
create index if not exists screen_add_requests_session_idx
  on public.screen_add_requests (stripe_session_id);

-- RLS: advertisers may READ their own requests (so the UI can show a pending
-- one). All WRITES go through the service-role client (server action + webhook),
-- which bypasses RLS.
alter table public.screen_add_requests enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'screen_add_requests'
      and policyname = 'screen_add_requests_owner_read'
  ) then
    create policy screen_add_requests_owner_read on public.screen_add_requests
      for select using (advertiser_id = auth.uid());
  end if;
end $$;
