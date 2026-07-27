-- Loop Network — let an admin replace a HOUSE slide with an uploaded creative.
--
-- The two house slides (the Jville Brew Loop ad and the "Advertise on this screen"
-- card) are hand-built React components. They play on every screen and an admin
-- can't touch them without a deploy, so a slide someone doesn't like is stuck
-- there. This adds an override: upload an image or video for a house slide and the
-- TV plays that instead of the built-in design.
--
-- Nothing is replaced by default. With no active row here, every screen renders
-- the built-in slide exactly as before — the same fallback shape the trivia and
-- filler tables already use.
--
-- Scope follows the pattern set by trivia_questions: a NULL territory_id is the
-- network-wide default, and a row naming a territory overrides it for that market
-- only. So one creative can cover every screen, or Jacksonville can run its own
-- Brew Loop ad while Highland runs something else.
--
-- Apply via the Supabase SQL editor (no DATABASE_URL locally) or scripts/run-sql.js.

create table if not exists public.house_creatives (
  id uuid primary key default gen_random_uuid(),
  -- Which built-in slide this replaces. Deliberately a constrained text column
  -- rather than an enum: adding a third house slide later shouldn't need a type
  -- migration on a live database.
  kind text not null check (kind in ('brewloop', 'advertise')),
  -- NULL = every market. A territory id scopes the override to that market.
  territory_id uuid references public.territories(id) on delete cascade,
  creative_type text not null check (creative_type in ('image', 'video')),
  creative_url text not null,
  -- Scan-to-act QR drawn over the creative, same overlay math as a paid ad
  -- (center at x,y as fractions of the frame; width as a fraction of frame width).
  -- The house QR targets are fixed in the manifest route, so only placement is
  -- stored here. show_qr is off for a creative that bakes its own code in.
  show_qr boolean not null default true,
  qr_x real not null default 0.88,
  qr_y real not null default 0.82,
  qr_size real not null default 0.16,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One ACTIVE creative per slide per scope. Two partial indexes rather than one
-- constraint because NULL territory_id (the network-wide default) never collides
-- in a plain unique index — Postgres treats NULLs as distinct.
create unique index if not exists house_creatives_one_active_global
  on public.house_creatives (kind)
  where active and territory_id is null;

create unique index if not exists house_creatives_one_active_territory
  on public.house_creatives (kind, territory_id)
  where active and territory_id is not null;

alter table public.house_creatives enable row level security;

-- The TV manifest reads this with the service role, and only admins write it, so
-- there is no anon/authenticated policy on purpose: RLS on with no policy denies
-- everyone, and the service role bypasses it.
drop policy if exists "lm_house_creatives_admin_all" on public.house_creatives;
create policy "lm_house_creatives_admin_all" on public.house_creatives
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

comment on table public.house_creatives is
  'Uploaded overrides for the built-in house slides. No row = the built-in design plays.';
comment on column public.house_creatives.territory_id is
  'NULL = every market; a territory id overrides just that market.';

-- House creatives live in the existing public `creatives` bucket alongside ad
-- creatives (the TV loads them unauthenticated, so the bucket must stay public).
-- 0022 scoped that bucket's writes to <auth.uid()>/<file>, and admins upload under
-- their own uid like everyone else, so no new storage policy is needed here.
