-- 0049_loopnetwork_domain_admin
-- Standing rule: any @loopnetwork.org email is a global (Holdings-level) admin.
--   * handle_new_user() now grants role=admin (territory_id defaults null = global)
--     to new signups whose email ends in @loopnetwork.org.
--   * Back-fill any existing @loopnetwork.org profiles to global admin.
--
-- SECURITY NOTE: this trusts the email domain. It is only safe while Supabase
-- "Confirm email" is REQUIRED for login — otherwise someone could self-sign-up
-- as anything@loopnetwork.org (a mailbox they don't own) and land an admin
-- session. Keep email confirmation ON in Auth settings. Only Jacob/Stephen
-- control real @loopnetwork.org mailboxes (Google Workspace).

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    case
      when lower(new.email) like '%@loopnetwork.org'
        then 'admin'::user_role
      else coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'advertiser')
    end
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- Back-fill existing @loopnetwork.org accounts to global admin.
update public.profiles
   set role = 'admin', territory_id = null
 where lower(email) like '%@loopnetwork.org';
