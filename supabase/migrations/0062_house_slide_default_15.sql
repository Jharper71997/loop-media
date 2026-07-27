-- Loop Network — house slides default to 15s, like every paid slot.
--
-- 0050 added the per-screen house-slide durations but left them NULL, and the
-- player fell back to 10s. So a brand-new host's loop ran its house cards (the
-- Brew Loop ad, the "advertise on this screen" card, authored filler) at a
-- different, shorter beat than the 15s ads around them — and an admin had to go
-- set them by hand to even it out. A new screen should look right from the get-go.
--
-- Three parts: a real column DEFAULT so new rows land at 15, a backfill so the
-- screens already out there stop running at 10, and the matching player fallback
-- lives in app/tv/TvPlayer.tsx (FILLER_SECONDS).
--
-- The trivia teaser is deliberately NOT touched — it holds longer than a house
-- card because it now carries a live question people have to read and answer.
--
-- Apply via the Supabase SQL editor or scripts/run-sql.js.

alter table tvs alter column brewloop_seconds  set default 15;
alter table tvs alter column advertise_seconds set default 15;
alter table tvs alter column filler_seconds    set default 15;

-- Screens created before this: only the ones still on the implicit fallback. A
-- screen someone deliberately set to another number keeps it.
update tvs set brewloop_seconds  = 15 where brewloop_seconds  is null;
update tvs set advertise_seconds = 15 where advertise_seconds is null;
update tvs set filler_seconds    = 15 where filler_seconds    is null;

comment on column tvs.brewloop_seconds  is 'Seconds the Brew Loop house ad holds on this screen (default 15, same as a paid slot).';
comment on column tvs.advertise_seconds is 'Seconds the "Advertise here" house card holds (default 15, same as a paid slot).';
comment on column tvs.filler_seconds    is 'Seconds each authored filler card holds (default 15, same as a paid slot).';
