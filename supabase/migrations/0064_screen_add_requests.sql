-- 0064_screen_add_requests.sql
-- Adding screens to a live campaign is now a PAID change.
--
-- Before this, addScreensToCampaign put the screens on the campaign immediately
-- and only staged the price difference as a Stripe proration on the NEXT invoice.
-- Two ways that leaked money:
--   * the ad aired for the rest of the billing period before any cash moved, and
--     nothing in Stripe showed a payment for the added screen;
--   * the Stripe call was best-effort inside a swallowed catch, so a failure left
--     the screens live at the old monthly rate with no trail.
--
-- Now the increase is charged UP FRONT in a one-time Checkout, and the screens
-- only join the campaign once that payment lands (webhook -> applyScreenAdd).
-- Same staging pattern as ad_change_requests (0019).
--
-- Re-runnable: guarded with IF NOT EXISTS throughout.

create table if not exists public.screen_add_requests (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns(id) on delete cascade,
  advertiser_id     uuid not null references public.profiles(id) on delete cascade,
  -- The venues being added, held as an array (not target rows) so the request is
  -- one atomic thing to pay for and apply. They become campaign_targets on apply.
  venue_ids         uuid[] not null,
  -- What they pay NOW (the increase over the current monthly total)...
  amount_cents      integer not null default 0,
  -- ...and what the subscription becomes ONGOING, priced over the whole cart.
  new_monthly_cents integer not null,
  -- 'pending_payment' (awaiting the increase), 'applied' (screens live + monthly
  -- updated), 'waived' (nothing to charge: host perk / no Stripe / $0 increase),
  -- 'canceled'
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
-- add). All WRITES go through the service-role client (server action + webhook),
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
