-- Loop Network — per-device secret for screen authentication
--
-- Screens were identified on /api/tv/loop, /play (ad_plays) and /heartbeat by
-- device_id ALONE — a UUID with no secret — so a leaked or guessed device_id could
-- impersonate a screen and post fake plays (making ad_plays untrustworthy for
-- billing/measured impressions). This adds a companion secret minted at pairing and
-- required on those endpoints via the x-device-secret header (or ?secret= on a
-- provisioned kiosk URL).
--
-- Backfill-safe: existing screens have a NULL secret and are grandfathered through
-- (the endpoints accept a null-secret device), so nothing bricks on deploy. A
-- screen gains a secret the next time it pairs (or an admin regenerates its code).
--
-- Idempotent. Apply via the Supabase SQL editor or `scripts/apply-migrations.js`.

alter table tvs add column if not exists device_secret text;
