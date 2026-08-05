-- Editable business settings.
--
-- One key/value row per knob that used to be a hardcoded constant. The registry
-- that names them and holds their defaults lives in lib/settings.ts; this table
-- only stores OVERRIDES, so it is deliberately seeded empty. An absent row means
-- "use the coded default", which is also what happens if this table is missing
-- entirely — see lib/settings.server.ts. That is what lets the app ship before
-- this migration is applied.
--
-- value is jsonb because settings are not all the same type: most are integers
-- (cents, days, counts) but the goal deadline is free text.

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- Prices and limits are published facts (an advertiser's checkout has to price a
-- creative-help add-on, the upload form has to know the size cap), so reads are
-- open. Writes are admin-only.
alter table public.app_settings enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_settings'
      and policyname = 'app_settings_read'
  ) then
    create policy app_settings_read on public.app_settings
      for select using (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_settings'
      and policyname = 'app_settings_admin_write'
  ) then
    create policy app_settings_admin_write on public.app_settings
      for all to authenticated using (is_admin()) with check (is_admin());
  end if;
end $$;
