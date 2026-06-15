-- Loop Network — core schema (tables, enums, indexes, triggers)
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
-- Parent "Loop Network Holdings" row (parent_id null, is_holding true) sits above
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
-- Loop Network — Row Level Security
--
-- Roles: admin (global = territory_id null, sees all; territory-scoped = sees
-- own territory), advertiser (own rows), host (own venue + promos). The TV
-- display, placement engine, Stripe webhook and QR redirect run server-side
-- with the SERVICE ROLE key, which bypasses RLS — so anon/public never touch
-- these tables directly.
--
-- NOTE: territory scoping for admins is enforced here on tables that carry a
-- direct territory_id; join-only tables (tvs, ad_placements, qr_scans) grant
-- any admin and rely on the app + service role for finer scoping (tighten later).

-- ---------- helper predicates (security definer => no RLS recursion) ----------
create or replace function auth_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function auth_territory()
returns uuid language sql stable security definer set search_path = public as $$
  select territory_id from public.profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function is_global_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin' and territory_id is null from public.profiles where id = auth.uid()),
    false);
$$;

-- admin who may touch a row carrying the given territory
create or replace function admin_can_territory(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_global_admin() or (auth_role() = 'admin' and auth_territory() = t);
$$;

-- ---------- enable RLS everywhere ----------
alter table territories             enable row level security;
alter table profiles                enable row level security;
alter table categories              enable row level security;
alter table category_caps           enable row level security;
alter table venues                  enable row level security;
alter table tvs                     enable row level security;
alter table ads                     enable row level security;
alter table creative_requests       enable row level security;
alter table packages                enable row level security;
alter table package_territory_prices enable row level security;
alter table campaigns               enable row level security;
alter table subscriptions           enable row level security;
alter table ad_placements           enable row level security;
alter table qr_scans                enable row level security;
alter table filler_content          enable row level security;

-- ---------- profiles ----------
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or is_admin());
create policy profiles_insert on profiles for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on profiles for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- territories ----------
create policy territories_select on territories for select to authenticated using (true);
create policy territories_admin_write on territories for all to authenticated
  using (is_global_admin()) with check (is_global_admin());

-- ---------- categories (global catalog) ----------
create policy categories_select on categories for select to authenticated using (true);
create policy categories_admin_write on categories for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- category_caps ----------
create policy caps_select on category_caps for select to authenticated using (true);
create policy caps_admin_write on category_caps for all to authenticated
  using (admin_can_territory(territory_id)) with check (admin_can_territory(territory_id));

-- ---------- venues (inventory: any authenticated user may browse) ----------
create policy venues_select on venues for select to authenticated using (true);
create policy venues_admin_write on venues for all to authenticated
  using (admin_can_territory(territory_id)) with check (admin_can_territory(territory_id));

-- ---------- tvs (inventory + status) ----------
create policy tvs_select on tvs for select to authenticated using (true);
create policy tvs_admin_write on tvs for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- ads ----------
-- advertisers see/own their ads; hosts see/own promos for venues they host; admins see territory.
create policy ads_select on ads for select to authenticated using (
  owner_user_id = auth.uid()
  or admin_can_territory(territory_id)
  or (owner_kind = 'host' and host_venue_id in
        (select id from venues where host_user_id = auth.uid()))
);
create policy ads_owner_insert on ads for insert to authenticated
  with check (owner_user_id = auth.uid());
create policy ads_owner_update on ads for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy ads_owner_delete on ads for delete to authenticated
  using (owner_user_id = auth.uid());
create policy ads_admin_all on ads for all to authenticated
  using (admin_can_territory(territory_id)) with check (admin_can_territory(territory_id));

-- ---------- creative_requests ----------
create policy creq_owner on creative_requests for all to authenticated
  using (advertiser_id = auth.uid()) with check (advertiser_id = auth.uid());
create policy creq_admin on creative_requests for select to authenticated using (is_admin());

-- ---------- packages & prices (read by all, write by admin) ----------
create policy packages_select on packages for select to authenticated using (true);
create policy packages_admin_write on packages for all to authenticated
  using (is_admin()) with check (is_admin());
create policy ptp_select on package_territory_prices for select to authenticated using (true);
create policy ptp_admin_write on package_territory_prices for all to authenticated
  using (admin_can_territory(territory_id)) with check (admin_can_territory(territory_id));

-- ---------- campaigns ----------
create policy campaigns_owner on campaigns for all to authenticated
  using (advertiser_id = auth.uid()) with check (advertiser_id = auth.uid());
create policy campaigns_admin on campaigns for all to authenticated
  using (admin_can_territory(territory_id)) with check (admin_can_territory(territory_id));

-- ---------- subscriptions ----------
create policy subs_owner on subscriptions for all to authenticated
  using (advertiser_id = auth.uid()) with check (advertiser_id = auth.uid());
create policy subs_admin on subscriptions for select to authenticated using (is_admin());

-- ---------- ad_placements ----------
-- advertiser sees placements for their campaigns; host sees placements on their TVs; admin all.
create policy placements_select on ad_placements for select to authenticated using (
  is_admin()
  or campaign_id in (select id from campaigns where advertiser_id = auth.uid())
  or tv_id in (select t.id from tvs t join venues v on v.id = t.venue_id
               where v.host_user_id = auth.uid())
);
create policy placements_admin_write on ad_placements for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- qr_scans (inserted server-side via service role) ----------
create policy qr_select on qr_scans for select to authenticated using (
  is_admin() or ad_id in (select id from ads where owner_user_id = auth.uid())
);

-- ---------- filler_content ----------
create policy filler_select on filler_content for select to authenticated using (true);
create policy filler_admin_write on filler_content for all to authenticated
  using (admin_can_territory(territory_id)) with check (admin_can_territory(territory_id));
-- Loop Network — demo seed (one territory, categories + caps, packages, venues + TVs)
-- Safe to re-run: guarded with ON CONFLICT / NOT EXISTS.

-- ---------- territories: Holdings parent + one demo city ----------
insert into territories (name, slug, is_holding, timezone, status)
values ('Loop Network Holdings', 'holdings', true, 'America/Chicago', 'active')
on conflict (slug) do nothing;

insert into territories (name, slug, parent_id, timezone, status)
select 'Crown Point, IN', 'crown-point',
       (select id from territories where slug = 'holdings'),
       'America/Chicago', 'active'
on conflict (slug) do nothing;

-- ---------- category catalog ----------
insert into categories (name, slug) values
  ('Restaurant',      'restaurant'),
  ('Bar / Nightlife', 'bar'),
  ('Gym / Fitness',   'gym'),
  ('Barber Shop',     'barber'),
  ('Tattoo Shop',     'tattoo'),
  ('Brewery',         'brewery'),
  ('Coffee Shop',     'coffee'),
  ('Smoke Shop',      'smoke_shop')
on conflict (slug) do nothing;

-- ---------- per-city caps (max advertisers per category) ----------
insert into category_caps (territory_id, category_id, max_advertisers)
select (select id from territories where slug = 'crown-point'), c.id, v.cap
from (values
  ('restaurant',3), ('bar',2), ('gym',2), ('barber',2),
  ('tattoo',2), ('brewery',1), ('coffee',2), ('smoke_shop',1)
) as v(slug, cap)
join categories c on c.slug = v.slug
on conflict (territory_id, category_id) do nothing;

-- ---------- packages (global templates; price + screen cap + default goal) ----------
-- Prices are placeholders (low end of the quoted ranges); edit in admin.
insert into packages (tier, name, screen_cap, target_impressions, base_price_cents, territory_id, active)
select x.tier::package_tier, x.name, x.cap, x.tgt, x.price, null, true
from (values
  ('bronze', 'Bronze',  5,  25000,  14900),
  ('silver', 'Silver',  10, 60000,  24900),
  ('gold',   'Gold',    20, 150000, 39900)
) as x(tier, name, cap, tgt, price)
where not exists (
  select 1 from packages p where p.tier = x.tier::package_tier and p.territory_id is null
);

insert into packages (tier, name, screen_cap, target_impressions, base_price_cents, territory_id, active)
select 'custom', 'Custom (build your own)', null, 0, 0, null, true
where not exists (select 1 from packages p where p.tier = 'custom' and p.territory_id is null);

-- ---------- demo venues (only if the city has none yet) ----------
insert into venues (territory_id, name, address, lat, lng, venue_type, category_id, foot_traffic_estimate, status)
select (select id from territories where slug = 'crown-point'),
       d.name, d.address, d.lat, d.lng, d.venue_type, c.id, d.foot, 'active'
from (values
  ('The Tap House',        '120 N Main St, Crown Point, IN',   41.41700, -87.36500, 'Sports Bar',  'bar',     18000),
  ('Iron Works Gym',       '888 E Summit St, Crown Point, IN', 41.41400, -87.34900, 'Gym',         'gym',     22000),
  ('Fade Factory Barbers', '55 S Court St, Crown Point, IN',   41.41600, -87.36600, 'Barber Shop', 'barber',   9000),
  ('Region Brews Coffee',  '210 N Main St, Crown Point, IN',   41.41850, -87.36480, 'Coffee Shop', 'coffee',  15000),
  ('Crossroads Brewery',   '99 W Joliet St, Crown Point, IN',  41.41650, -87.36800, 'Brewery',     'brewery', 12000)
) as d(name, address, lat, lng, venue_type, catslug, foot)
join categories c on c.slug = d.catslug
where not exists (
  select 1 from venues v
  where v.territory_id = (select id from territories where slug = 'crown-point')
);

-- ---------- one TV per demo venue (pairing codes for the TV display demo) ----------
insert into tvs (venue_id, pairing_code, status)
select v.id, t.code, 'unpaired'
from (values
  ('The Tap House',        'LM-TAP1'),
  ('Iron Works Gym',       'LM-IRON1'),
  ('Fade Factory Barbers', 'LM-FADE1'),
  ('Region Brews Coffee',  'LM-BREW1'),
  ('Crossroads Brewery',   'LM-XRDS1')
) as t(vname, code)
join venues v on v.name = t.vname
  and v.territory_id = (select id from territories where slug = 'crown-point')
on conflict (pairing_code) do nothing;

-- ---------- promote yourself to admin AFTER you sign up through the app ----------
-- Global (Holdings) admin:
--   update profiles set role = 'admin', territory_id = null where email = 'you@example.com';
-- City-scoped admin:
--   update profiles set role = 'admin',
--     territory_id = (select id from territories where slug = 'crown-point')
--   where email = 'citymanager@example.com';
-- Loop Network: first launch market is Jacksonville, NC (Eastern time).
-- Renames the seeded demo territory and repositions its demo venues.
-- Append-only: on a fresh DB this runs after 0003 (which seeds Crown Point).

update territories
set name = 'Jacksonville, NC',
    slug = 'jacksonville-nc',
    timezone = 'America/New_York'
where slug = 'crown-point';

-- Reposition the demo venues into the Jacksonville, NC area (approx coords).
with terr as (select id from territories where slug = 'jacksonville-nc')
update venues v set
  name    = c.new_name,
  address = c.address,
  lat     = c.lat,
  lng     = c.lng
from (values
  ('The Tap House',        'The Tap House',         '118 Old Bridge St, Jacksonville, NC', 34.75300, -77.43100),
  ('Iron Works Gym',       'Iron Works Gym',        '2155 N Marine Blvd, Jacksonville, NC', 34.77050, -77.41350),
  ('Fade Factory Barbers', 'Fade Factory Barbers',  '330 Western Blvd, Jacksonville, NC',  34.75620, -77.40980),
  ('Region Brews Coffee',  'Coastal Grounds Coffee','200 New Bridge St, Jacksonville, NC', 34.75480, -77.42850),
  ('Crossroads Brewery',   'Riverwalk Brewing Co.', '10 Court St, Jacksonville, NC',       34.75150, -77.43250)
) as c(old_name, new_name, address, lat, lng)
where v.name = c.old_name
  and v.territory_id = (select id from terr);
-- Storage buckets for ad creatives + host promos (public read for the TV loop).

insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('host-promos', 'host-promos', true)
on conflict (id) do nothing;

-- Authenticated users may upload/replace objects in these buckets.
drop policy if exists "lm_creatives_insert" on storage.objects;
create policy "lm_creatives_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('creatives', 'host-promos'));

drop policy if exists "lm_creatives_update" on storage.objects;
create policy "lm_creatives_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('creatives', 'host-promos'));

-- Public read (buckets are public; explicit policy for completeness).
drop policy if exists "lm_creatives_read" on storage.objects;
create policy "lm_creatives_read" on storage.objects
  for select to public
  using (bucket_id in ('creatives', 'host-promos'));
