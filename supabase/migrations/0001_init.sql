-- Loop Media — core schema (tables, enums, indexes, triggers)
-- Apply in order: 0001_init.sql -> 0002_rls.sql -> 0003_seed.sql

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ============================================================
-- ENUMS
-- ============================================================
create type user_role               as enum ('admin', 'advertiser', 'host');
create type territory_status        as enum ('active', 'inactive');
create type venue_status            as enum ('active', 'inactive');
create type tv_status               as enum ('unpaired', 'online', 'offline');
create type ad_owner_kind           as enum ('advertiser', 'host');
create type creative_type           as enum ('video', 'image');
create type ad_status               as enum ('pending', 'approved', 'rejected', 'paused', 'active');
create type creative_request_status as enum ('open', 'in_progress', 'done');
create type package_tier            as enum ('bronze', 'silver', 'gold', 'custom');
create type campaign_status         as enum ('draft', 'active', 'paused', 'canceled');
create type subscription_status     as enum ('active', 'paused', 'canceled', 'past_due', 'incomplete');
create type placement_status        as enum ('active', 'paused', 'ended');
create type filler_type             as enum ('weather', 'sports', 'trivia', 'event', 'promo');

-- ============================================================
-- Shared trigger: keep updated_at fresh
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ============================================================
-- TENANCY
-- ============================================================
-- Parent "Loop Media Holdings" row (parent_id null, is_holding true) sits above
-- child city LLCs (parent_id -> holdings). Everything scopes to a territory.
create table territories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  parent_id  uuid references territories(id) on delete set null,
  is_holding boolean not null default false,
  timezone   text not null default 'America/Chicago',
  status     territory_status not null default 'active',
  created_at timestamptz not null default now()
);

-- Mirror of auth.users; row auto-created on signup (see handle_new_user below).
-- role=admin with territory_id null == Holdings-level / global admin.
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  phone        text,
  role         user_role not null default 'advertiser',
  territory_id uuid references territories(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index idx_profiles_territory on profiles(territory_id);

-- ============================================================
-- CATALOG & VENUES
-- ============================================================
-- Global category catalog. Used for BOTH a venue's own type and an ad's
-- category, so exact-match exclusivity compares like-for-like.
create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- Per-city cap on how many advertisers of a category may be active.
create table category_caps (
  id              uuid primary key default gen_random_uuid(),
  territory_id    uuid not null references territories(id) on delete cascade,
  category_id     uuid not null references categories(id) on delete cascade,
  max_advertisers int  not null default 1 check (max_advertisers >= 0),
  created_at      timestamptz not null default now(),
  unique (territory_id, category_id)
);

create table venues (
  id                    uuid primary key default gen_random_uuid(),
  territory_id          uuid not null references territories(id) on delete restrict,
  name                  text not null,
  address               text,
  lat                   numeric(9,6),
  lng                   numeric(9,6),
  venue_type            text,                                          -- display label
  category_id           uuid references categories(id) on delete set null, -- structured type for exclusivity
  foot_traffic_estimate int  not null default 0 check (foot_traffic_estimate >= 0), -- ~monthly visitors
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  host_user_id          uuid references profiles(id) on delete set null,
  status                venue_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_venues_territory on venues(territory_id);
create index idx_venues_category  on venues(category_id);
create index idx_venues_host      on venues(host_user_id);
create trigger trg_venues_updated before update on venues
  for each row execute function set_updated_at();

create table tvs (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references venues(id) on delete cascade,
  device_id           text unique,                       -- set at pairing
  pairing_code        text unique,                       -- short code to pair a device
  status              tv_status not null default 'unpaired',
  loop_length_seconds int not null default 360 check (loop_length_seconds > 0),
  slot_seconds        int not null default 15  check (slot_seconds > 0),
  last_sync_at        timestamptz,
  last_heartbeat_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_tvs_venue on tvs(venue_id);
create trigger trg_tvs_updated before update on tvs
  for each row execute function set_updated_at();

-- ============================================================
-- ADS & CREATIVE  (advertiser ads AND host promos share this pipeline)
-- ============================================================
create table ads (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references profiles(id) on delete cascade,
  owner_kind       ad_owner_kind not null default 'advertiser',
  territory_id     uuid not null references territories(id) on delete restrict,
  category_id      uuid references categories(id) on delete set null, -- advertiser's business type
  host_venue_id    uuid references venues(id) on delete cascade,      -- set for host promos
  title            text not null,
  creative_type    creative_type not null,
  creative_url     text,                                              -- storage path
  duration_seconds int not null default 15 check (duration_seconds > 0),
  status           ad_status not null default 'pending',
  rejection_reason text,
  qr_target_url    text,                                              -- where the on-screen QR points
  qr_code_url      text,
  reviewed_by      uuid references profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_ads_owner     on ads(owner_user_id);
create index idx_ads_territory on ads(territory_id);
create index idx_ads_status    on ads(status);
create index idx_ads_host      on ads(host_venue_id);
create trigger trg_ads_updated before update on ads
  for each row execute function set_updated_at();

-- A host gets 3 free promo slots. Enforce max 3 non-rejected host ads per host.
create or replace function enforce_host_promo_limit()
returns trigger language plpgsql as $$
begin
  if new.owner_kind = 'host' and new.status <> 'rejected' then
    if (select count(*) from ads
          where owner_user_id = new.owner_user_id
            and owner_kind   = 'host'
            and status      <> 'rejected'
            and id          <> new.id) >= 3 then
      raise exception 'Host promo limit reached (max 3 slots)';
    end if;
  end if;
  return new;
end; $$;
create trigger trg_host_promo_limit before insert or update on ads
  for each row execute function enforce_host_promo_limit();

-- "Request creative help" form submissions.
create table creative_requests (
  id            uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references profiles(id) on delete cascade,
  brief         text not null,
  status        creative_request_status not null default 'open',
  created_at    timestamptz not null default now()
);
create index idx_creative_requests_adv on creative_requests(advertiser_id);

-- ============================================================
-- PACKAGES, CAMPAIGNS & BILLING
-- ============================================================
-- territory_id null == global template package. screen_cap null == custom.
create table packages (
  id                 uuid primary key default gen_random_uuid(),
  tier               package_tier not null,
  name               text not null,
  screen_cap         int check (screen_cap > 0),
  target_impressions int  not null default 0 check (target_impressions >= 0), -- default monthly goal
  base_price_cents   int  not null default 0 check (base_price_cents >= 0),
  stripe_price_id    text,
  territory_id       uuid references territories(id) on delete cascade,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create index idx_packages_territory on packages(territory_id);

-- Optional per-city price override. No row -> fall back to packages.base_price_cents.
create table package_territory_prices (
  id              uuid primary key default gen_random_uuid(),
  package_id      uuid not null references packages(id) on delete cascade,
  territory_id    uuid not null references territories(id) on delete cascade,
  price_cents     int  not null check (price_cents >= 0),
  stripe_price_id text,
  created_at      timestamptz not null default now(),
  unique (package_id, territory_id)
);

-- Ties an ad to its traffic goal + package; the placement engine fills toward target_impressions.
create table campaigns (
  id                 uuid primary key default gen_random_uuid(),
  advertiser_id      uuid not null references profiles(id) on delete cascade,
  ad_id              uuid references ads(id) on delete set null,
  package_id         uuid references packages(id) on delete set null,
  territory_id       uuid not null references territories(id) on delete restrict,
  target_impressions int  not null default 0 check (target_impressions >= 0),
  status             campaign_status not null default 'draft',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_campaigns_adv       on campaigns(advertiser_id);
create index idx_campaigns_territory on campaigns(territory_id);
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function set_updated_at();

create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  advertiser_id          uuid not null references profiles(id) on delete cascade,
  campaign_id            uuid references campaigns(id) on delete set null,
  package_id             uuid references packages(id) on delete set null,
  territory_id           uuid references territories(id) on delete set null,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  status                 subscription_status not null default 'incomplete',
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_subscriptions_adv on subscriptions(advertiser_id);
create trigger trg_subscriptions_updated before update on subscriptions
  for each row execute function set_updated_at();

-- ============================================================
-- PLACEMENT ENGINE OUTPUT & ANALYTICS
-- ============================================================
create table ad_placements (
  id            uuid primary key default gen_random_uuid(),
  ad_id         uuid not null references ads(id) on delete cascade,
  tv_id         uuid not null references tvs(id) on delete cascade,
  campaign_id   uuid references campaigns(id) on delete cascade,
  slot_position int  not null,
  start_date    date not null default current_date,
  end_date      date,
  status        placement_status not null default 'active',
  created_at    timestamptz not null default now()
);
-- An ad runs at most once per TV (while not ended); one ad per slot per TV.
create unique index uq_placement_ad_tv   on ad_placements(ad_id, tv_id)        where status <> 'ended';
create unique index uq_placement_tv_slot on ad_placements(tv_id, slot_position) where status = 'active';
create index idx_placement_tv_active on ad_placements(tv_id)       where status = 'active';
create index idx_placement_campaign  on ad_placements(campaign_id);

create table qr_scans (
  id         uuid primary key default gen_random_uuid(),
  ad_id      uuid not null references ads(id) on delete cascade,
  tv_id      uuid references tvs(id) on delete set null,
  scanned_at timestamptz not null default now(),
  user_agent text,
  ip_hash    text,                                  -- hashed, never raw IP
  referrer   text
);
create index idx_qr_scans_ad on qr_scans(ad_id, scanned_at);

-- Weather/sports/trivia/event auto-fetched & cached per territory; promo is admin-authored.
create table filler_content (
  id           uuid primary key default gen_random_uuid(),
  territory_id uuid not null references territories(id) on delete cascade,
  type         filler_type not null,
  payload      jsonb not null default '{}'::jsonb,
  active       boolean not null default true,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index idx_filler_territory on filler_content(territory_id, type) where active;

-- ============================================================
-- AUTH: auto-create a profile row when a user signs up
-- ============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'advertiser')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
