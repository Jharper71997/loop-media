-- Loop Network — let a house slide be turned OFF in a market, not just replaced.
--
-- 0063 made the two house slides (the Brew Loop ad and the "Advertise on this
-- screen" card) replaceable per market: a row here means "play this upload
-- instead of the built-in design". There was no way to say "do not play this
-- slide at all in Wilmington" — the player injected both onto every screen in
-- every market, because the ABSENCE of a row was the only other state there was.
--
-- This adds the missing state. A row now carries a MODE:
--   creative — play the uploaded file (what every existing row means)
--   builtin  — play the designed slide the player draws itself
--   off      — the slide is not in the loop at all for that scope
--
-- Resolution is unchanged and now lives in exactly one place (lib/houseSlides.ts):
-- a row naming the screen's market wins over the network-wide row (territory_id
-- null); with neither, the built-in design plays. `builtin` exists so ONE market
-- can be switched back on when the network-wide row is off — "off everywhere
-- except Jacksonville" is a global `off` row plus a Jacksonville `builtin` row.
--
-- Every existing row is an upload, so the default backfills them correctly and
-- nothing on a screen changes when this is applied.
--
-- Apply via the Supabase SQL editor (no DATABASE_URL locally) or scripts/run-sql.js.

alter table public.house_creatives
  add column if not exists mode text not null default 'creative';

alter table public.house_creatives
  drop constraint if exists house_creatives_mode_check;
alter table public.house_creatives
  add constraint house_creatives_mode_check
  check (mode in ('creative', 'builtin', 'off'));

-- A `builtin` or `off` row has no file behind it, so the creative columns have to
-- become droppable. They are still required together for mode='creative', which
-- the constraint below enforces — a row can't claim to play something it has no
-- URL for.
alter table public.house_creatives alter column creative_type drop not null;
alter table public.house_creatives alter column creative_url  drop not null;

alter table public.house_creatives
  drop constraint if exists house_creatives_creative_present;
alter table public.house_creatives
  add constraint house_creatives_creative_present
  check (mode <> 'creative' or (creative_type is not null and creative_url is not null));

comment on column public.house_creatives.mode is
  'creative = play the upload; builtin = play the designed slide; off = do not play this slide in this scope.';
comment on table public.house_creatives is
  'Per-market settings for the built-in house slides: replace with an upload, force the built-in design, or turn the slide off. No row = the built-in design plays.';
