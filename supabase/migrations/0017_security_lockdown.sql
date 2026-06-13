-- Loop Network — security lockdown (privilege-escalation fixes)
--
-- Closes the two critical broken-access-control holes found in the 2026-06-12
-- deep dive. Both are about the same thing: a stranger should NOT be able to
-- become an admin.
--
--   #1  Sign-up trusted a client-supplied role → anyone could sign up as admin.
--   #2  profiles row-update RLS had no column guard → any user could promote
--       their own row to admin.
--
-- Idempotent (create-or-replace + drop-if-exists), safe to re-run. Apply via the
-- Supabase SQL editor (project jdpaivfuusggtrdwiwqh) or `scripts/apply-migrations.js`.

-- ============================================================
-- #1 · Self-serve sign-ups may only be advertiser or host.
-- ============================================================
-- The signup form passes a role in user metadata, but the anon key ships in the
-- browser — so a crafted signUp() could request role:'admin'. Never trust it.
-- Admins are promoted explicitly by scripts/create-admin.js, which writes
-- role='admin' via the SERVICE ROLE *after* the user exists (allowed by the
-- guard in #2 because the service role has no auth.uid()).
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
  safe_role user_role := case
    when requested = 'host' then 'host'::user_role
    else 'advertiser'::user_role          -- anything else (incl. 'admin') → advertiser
  end;
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    safe_role
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- ============================================================
-- #2 · Guard the privileged profile columns (role, territory_id).
-- ============================================================
-- Postgres RLS can restrict WHICH ROWS a user updates, not WHICH COLUMNS — so the
-- existing profiles_update_self policy (id = auth.uid()) let a user change their
-- own role to 'admin'. This BEFORE UPDATE trigger reverts any change to role or
-- territory_id unless the caller is an admin or the service role.
--
-- Detection: a normal signed-in user has auth.uid() = the row's id. The service
-- role (used by scripts/create-admin.js and server actions) has auth.uid() = null,
-- so its updates pass through. Admins are allowed via is_admin().
create or replace function guard_profile_privileged_cols()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.territory_id is distinct from old.territory_id)
     and auth.uid() = old.id
     and not is_admin() then
    -- A non-admin is trying to change their own role/territory — revert silently
    -- so harmless self-edits (name, phone) on the same UPDATE still succeed.
    new.role := old.role;
    new.territory_id := old.territory_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_guard_profile_privileged on profiles;
create trigger trg_guard_profile_privileged
  before update on profiles
  for each row execute function guard_profile_privileged_cols();
