-- 0051_drop_domain_admin
-- Removes the @loopnetwork.org -> global-admin auto-grant from handle_new_user()
-- (added in 0049). That rule trusted the email domain and was only safe while
-- Supabase "Confirm email" was required. We are turning email confirmation OFF so
-- advertiser/host signup is frictionless, which means the domain trust must go --
-- otherwise anyone could self-sign-up as x@loopnetwork.org and land an admin session.
--
-- New behavior: a signup NEVER becomes admin automatically. Role comes from signup
-- metadata but is clamped to 'host' or 'advertiser' only, so a hand-crafted signup
-- passing role='admin' can no longer escalate either. Promote real staff by hand:
--   update public.profiles set role='admin', territory_id=null where email='name@loopnetwork.org';
--
-- Existing admins are untouched: this only redefines the trigger; it does not
-- modify any existing profiles row.

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    -- Never trust the email domain, and never let signup metadata request 'admin'.
    case
      when (new.raw_user_meta_data ->> 'role') = 'host' then 'host'::user_role
      else 'advertiser'::user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end; $$;
