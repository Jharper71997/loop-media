-- Loop Network — territory-scope admin writes on the join-only tables
--
-- 0002_rls.sql left the tvs + ad_placements admin policies as plain is_admin() with
-- an explicit "tighten later" note: ANY admin (including a territory-scoped one)
-- could write ANY screen or placement, relying on the app layer for finer scoping.
-- This scopes the WRITE policies to the admin's territory at the database. Global
-- admins keep full access. Reads are unchanged (tvs are public browse inventory;
-- ad_placements select is already owner/host/admin-scoped).
--
-- A tv's territory comes from its venue; a placement's from its campaign. The
-- placement engine and Stripe webhook write these tables via the service role,
-- which bypasses RLS, so they are unaffected — only authenticated-admin direct
-- writes are constrained.
--
-- Idempotent. Apply via the Supabase SQL editor or `scripts/apply-migrations.js`.

drop policy if exists tvs_admin_write on tvs;
create policy tvs_admin_write on tvs for all to authenticated
  using (
    is_global_admin()
    or exists (
      select 1 from venues v
      where v.id = tvs.venue_id and admin_can_territory(v.territory_id)
    )
  )
  with check (
    is_global_admin()
    or exists (
      select 1 from venues v
      where v.id = tvs.venue_id and admin_can_territory(v.territory_id)
    )
  );

drop policy if exists placements_admin_write on ad_placements;
create policy placements_admin_write on ad_placements for all to authenticated
  using (
    is_global_admin()
    or exists (
      select 1 from campaigns c
      where c.id = ad_placements.campaign_id and admin_can_territory(c.territory_id)
    )
  )
  with check (
    is_global_admin()
    or exists (
      select 1 from campaigns c
      where c.id = ad_placements.campaign_id and admin_can_territory(c.territory_id)
    )
  );
