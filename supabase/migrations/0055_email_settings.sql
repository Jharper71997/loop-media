-- 0055_email_settings.sql
-- Loop Network — admin-editable settings for the app's automated emails.
--
-- One row per automated email the app sends. Lets a network admin turn each email
-- on/off and override its copy (subject / heading / body) from /admin/email
-- without a code change. NULL copy columns mean "use the code default"; the
-- branded shell, CTA buttons, greeting, and any dynamic/data content stay
-- code-owned. Overrides are plain text with {placeholder} tokens the sender fills.
--
-- The send paths read this table via the service-role client (createAdminClient),
-- so the on/off gate works regardless of RLS; the policies below only guard the
-- admin editor. A missing row falls back to enabled + code default, so a new key
-- added in code never blocks a send before this row exists.
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

create table if not exists email_settings (
  key        text primary key,
  enabled    boolean not null default true,
  subject    text,
  heading    text,
  body       text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table email_settings enable row level security;

do $$ begin
  create policy email_settings_select on email_settings
    for select to authenticated using (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy email_settings_admin_write on email_settings
    for all to authenticated using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- Seed one enabled row per known email (copy columns NULL = "use code default").
insert into email_settings (key) values
  ('campaign_created'),
  ('ad_approved'),
  ('ad_rejected'),
  ('payment_received'),
  ('payment_failed'),
  ('monthly_report'),
  ('screen_offline'),
  ('screen_live')
on conflict (key) do nothing;
