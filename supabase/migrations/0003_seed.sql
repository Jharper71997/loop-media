-- Loop Media — demo seed (one territory, categories + caps, packages, venues + TVs)
-- Safe to re-run: guarded with ON CONFLICT / NOT EXISTS.

-- ---------- territories: Holdings parent + one demo city ----------
insert into territories (name, slug, is_holding, timezone, status)
values ('Loop Media Holdings', 'holdings', true, 'America/Chicago', 'active')
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
