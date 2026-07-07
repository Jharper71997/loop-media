-- Loop Network — paid, enforced category exclusivity.
--
-- Default stays co-run: unrelated advertisers share a screen, and a venue only
-- blocks a COMPETITOR in its OWN line of business (host protection, in code). This
-- adds an OPT-IN upcharge: an advertiser can BUY the right to be the only one in
-- their category at a specific venue. It's only sellable when no same-category
-- competitor is already active there (we never evict an existing advertiser), and
-- once active it blocks future same-category placements at that venue.
--
-- Pricing: a network default (pricing_config.exclusivity_price_cents) with an
-- optional per-venue override (venues.exclusivity_price_cents). Jacob sets the
-- number in /admin/pricing (default) and the venue dialog (override).
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

-- Per-venue upcharge override (null = use the network default).
alter table venues add column if not exists exclusivity_price_cents int;

-- Network default upcharge. $150/mo placeholder — CHANGE in /admin/pricing.
alter table pricing_config add column if not exists exclusivity_price_cents int not null default 15000;

create table if not exists exclusive_slots (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id)      on delete cascade,
  category_id   uuid not null references categories(id)  on delete cascade,
  campaign_id   uuid references campaigns(id)            on delete cascade,
  advertiser_id uuid references profiles(id)             on delete set null,
  territory_id  uuid references territories(id)          on delete set null,
  -- pending  = bought, awaiting payment confirmation (blocks nothing yet)
  -- active   = paid + enforced (blocks same-category competitors at the venue)
  -- released = paused/canceled/removed (frees the slot for someone else)
  status        text not null default 'pending' check (status in ('pending','active','released')),
  price_cents   int,               -- upcharge captured at purchase (for the ledger)
  created_at    timestamptz not null default now()
);

-- The heart of enforcement: at most ONE active exclusive per (venue, category).
create unique index if not exists exclusive_slots_active_uniq
  on exclusive_slots (venue_id, category_id) where status = 'active';

create index if not exists exclusive_slots_campaign on exclusive_slots (campaign_id);

alter table exclusive_slots enable row level security;

-- Read-only to the owner (their account/reports) and admins. All writes and
-- status transitions happen server-side via the service-role client, so there is
-- no insert/update/delete policy — an advertiser can never self-activate a slot.
do $$ begin
  create policy exclusive_owner on exclusive_slots for select to authenticated
    using (advertiser_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy exclusive_admin on exclusive_slots for select to authenticated
    using (is_admin());
exception when duplicate_object then null; end $$;
