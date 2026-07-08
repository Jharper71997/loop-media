-- Loop Network — per-screen, editable on-screen time for the HOUSE slides.
--
-- Paid ads already carry ads.duration_seconds (admin-editable). The house slides
-- the app injects on every screen (Brew Loop ad, "Advertise here" card, trivia
-- teaser, filler cards) had their time HARDCODED in the TV player (10s / 22s), so
-- there was nothing to edit. These per-screen columns let an admin set each one on
-- the screen detail page; NULL falls back to the player's built-in default, so
-- existing screens are unchanged until edited.
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js. Idempotent.

alter table tvs
  add column if not exists brewloop_seconds     int,
  add column if not exists advertise_seconds    int,
  add column if not exists trivia_slide_seconds int,
  add column if not exists filler_seconds        int;

comment on column tvs.brewloop_seconds     is 'Seconds the Brew Loop house ad holds on this screen (null = player default 10s).';
comment on column tvs.advertise_seconds    is 'Seconds the "Advertise here" house card holds (null = player default 10s).';
comment on column tvs.trivia_slide_seconds is 'Seconds the trivia teaser holds (null = player default 22s).';
comment on column tvs.filler_seconds       is 'Seconds each authored filler card holds (null = player default 10s).';
