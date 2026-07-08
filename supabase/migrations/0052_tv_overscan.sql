-- 0052_tv_overscan
-- Per-screen overscan compensation. Some TVs "overscan" — they zoom the picture a
-- few percent past the panel edges, cutting off content (e.g. the corner QR and the
-- edges of an ad). That's a property of the physical TV, not the app, so a single
-- screen can be clipped while every other renders fine.
--
-- overscan_pct is a safe-area inset PER SIDE, as a percent of each dimension. The
-- TV player insets all content by this much, so the strip the TV eats is just the
-- black margin we added and nothing important lands in it. null = the player's
-- built-in default (3%). Set higher for a badly-overscanning TV, or 0 to go fully
-- edge-to-edge on a screen that doesn't overscan.
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js. Idempotent.

alter table tvs
  add column if not exists overscan_pct int
    check (overscan_pct is null or (overscan_pct >= 0 and overscan_pct <= 15));

comment on column tvs.overscan_pct is
  'Safe-area inset per side (percent of each dimension) to compensate for a TV that overscans/zooms past its edges. null = player default (3%). 0 = edge-to-edge.';
