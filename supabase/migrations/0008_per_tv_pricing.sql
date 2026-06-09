-- Loop Media — per-TV à la carte pricing model.
--
-- Pivots the product from CPM packages + impression-goal auto-placement to the
-- model Stephen described: each venue carries a price TIER, advertisers tap
-- venues into a cart, and the monthly bill is the sum of the picked venues'
-- prices (with volume + loyalty discounts and a $200 floor, computed in
-- lib/pricing.ts). Exclusivity is per (venue, category): once a venue's category
-- slots for the advertiser's category are full it grays out, and the advertiser
-- can join a notify-me waitlist for the next opening.
--
-- Append-only and idempotent: safe to run after 0007 on an existing DB.

-- ---- price tier -------------------------------------------------------------
do $$ begin
  create type price_tier as enum ('local', 'standard', 'high', 'premium');
exception when duplicate_object then null; end $$;

alter table venues
  add column if not exists price_tier price_tier,
  -- how many DISTINCT advertisers of the SAME category may run at this venue at
  -- once. 1 = pure category exclusivity (the default). Operator can widen it.
  add column if not exists category_slots int not null default 1 check (category_slots >= 0);

-- Backfill a starting tier from the stored foot-traffic estimate (~monthly
-- visitors). Operator-adjustable afterward in the admin venue dialog — the tier
-- column, not foot traffic, is the source of truth for price.
update venues set price_tier = case
  when foot_traffic_estimate >= 40000 then 'premium'::price_tier
  when foot_traffic_estimate >= 20000 then 'high'::price_tier
  when foot_traffic_estimate >= 10000 then 'standard'::price_tier
  else 'local'::price_tier
end
where price_tier is null;

-- ---- cart total captured at checkout ----------------------------------------
-- The agreed monthly bill (post-discount, post-floor) for the campaign's picked
-- venues, frozen at checkout so later price-tier changes don't move the bill.
alter table campaigns
  add column if not exists monthly_total_cents int check (monthly_total_cents >= 0);

-- ---- notify-me waitlist for full (venue, category) --------------------------
create table if not exists venue_waitlist (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id) on delete cascade,
  category_id   uuid references categories(id) on delete set null,
  advertiser_id uuid not null references profiles(id) on delete cascade,
  notified_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (venue_id, category_id, advertiser_id)
);
create index if not exists idx_venue_waitlist_venue on venue_waitlist(venue_id);
create index if not exists idx_venue_waitlist_adv   on venue_waitlist(advertiser_id);

alter table venue_waitlist enable row level security;

-- Advertiser manages their own waitlist rows; admins see/manage all.
do $$ begin
  create policy vw_owner on venue_waitlist for all to authenticated
    using (advertiser_id = auth.uid()) with check (advertiser_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy vw_admin on venue_waitlist for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;
