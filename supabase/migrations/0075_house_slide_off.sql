-- Loop Network — let an admin take a HOUSE slide off the screens.
--
-- Until now the two house slides (the Jville Brew Loop ad and the "Advertise on
-- this screen" card) were unconditional: 0063 let an admin REPLACE one with an
-- uploaded creative, but there was no way to stop one playing. A venue that isn't
-- a Brew Loop partner still ran the Brew Loop ad, and a sold-out screen still
-- begged for advertisers.
--
-- Two levels, because both questions are real:
--   * house_slide_settings — off for the whole network, or off for one market.
--   * tvs.brewloop_enabled / advertise_enabled — off for ONE screen.
-- A slide plays only when both say yes; either one saying "off" wins. Nothing is
-- off by default, so an untouched database plays exactly what it plays today.
--
-- Apply via the Supabase SQL editor (no DATABASE_URL locally) or scripts/run-sql.js.

-- ---------- per-screen ----------
-- Sits beside the per-screen SECONDS columns from 0050: same row, same admin page,
-- one is "how long" and this is "at all".
alter table public.tvs
  add column if not exists brewloop_enabled boolean not null default true,
  add column if not exists advertise_enabled boolean not null default true;

comment on column public.tvs.brewloop_enabled is
  'false = this screen does not play the Brew Loop house slide.';
comment on column public.tvs.advertise_enabled is
  'false = this screen does not play the "Advertise on this screen" house slide.';

-- ---------- network / per market ----------
-- Scope follows house_creatives and trivia_questions: a NULL territory_id is the
-- network-wide setting, and a row naming a territory overrides it for that market.
-- No row at all = on, so this table is empty on a database nobody has touched.
create table if not exists public.house_slide_settings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('brewloop', 'advertise')),
  territory_id uuid references public.territories(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One setting per slide per scope. Two partial indexes rather than one constraint
-- because a plain unique index treats NULL territory_id (the network-wide row) as
-- distinct from itself, so it would let duplicates in. Same shape as 0063.
create unique index if not exists house_slide_settings_one_global
  on public.house_slide_settings (kind)
  where territory_id is null;

create unique index if not exists house_slide_settings_one_territory
  on public.house_slide_settings (kind, territory_id)
  where territory_id is not null;

alter table public.house_slide_settings enable row level security;

-- Read by the TV manifest with the service role and written only by admins, so
-- there is deliberately no anon policy: RLS on with no matching policy denies
-- everyone, and the service role bypasses it.
drop policy if exists "lm_house_slide_settings_admin_all" on public.house_slide_settings;
create policy "lm_house_slide_settings_admin_all" on public.house_slide_settings
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

comment on table public.house_slide_settings is
  'Whether a built-in house slide plays. No row = it plays. NULL territory_id = network-wide.';
