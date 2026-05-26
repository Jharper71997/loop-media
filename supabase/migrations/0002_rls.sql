-- Loop Media — Row Level Security
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
