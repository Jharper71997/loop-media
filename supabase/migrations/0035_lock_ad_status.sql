-- Loop Network — lock ad approval status at the database
--
-- Closes a broken-access-control hole: the ads_owner_update RLS policy
-- (0002_rls.sql) only checks owner_user_id = auth.uid() and has NO column guard.
-- Postgres RLS can restrict WHICH ROWS a user updates, not WHICH COLUMNS — so an
-- advertiser could issue a direct PostgREST PATCH setting their own ad's
-- status -> 'approved'/'active', then pay, and have UNREVIEWED creative placed on
-- screens by the Stripe webhook (activatePlacementsIfReady). Approval must be an
-- admin-only transition.
--
-- Same pattern as guard_profile_privileged_cols() in 0017: a BEFORE UPDATE trigger
-- that reverts any status change made by a signed-in non-admin, while leaving other
-- columns on the same UPDATE untouched (so harmless self-edits still succeed).
--
-- Who is allowed to change status:
--   * admins            — is_admin() true (admin queue approve/reject runs as the
--                         authenticated admin under requireAdmin()).
--   * the service role  — auth.uid() is null (advertiser pause/resume and the
--                         placement engine set status via the service-role client).
-- Everyone else (a signed-in advertiser/host hitting PostgREST directly) is reverted.
--
-- Idempotent (create-or-replace + drop-if-exists), safe to re-run. Apply via the
-- Supabase SQL editor or `scripts/apply-migrations.js`.

create or replace function guard_ads_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and not is_admin() then
    -- A signed-in non-admin is trying to change approval status — revert silently
    -- so other edits on the same UPDATE (e.g. creative swap, name) still apply.
    new.status := old.status;
  end if;
  return new;
end; $$;

drop trigger if exists trg_guard_ad_status on ads;
create trigger trg_guard_ad_status
  before update on ads
  for each row execute function guard_ads_status();
