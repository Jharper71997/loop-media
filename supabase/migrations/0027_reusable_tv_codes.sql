-- Reusable, host-visible pairing codes (no DO block, so it also runs in the
-- Supabase SQL editor). Give every existing screen a fresh 4-char code in the
-- safe alphabet (no ambiguous 0/O/1/I). pairing_code stays UNIQUE and device_id
-- bindings are untouched. random() is fine for this one-time backfill; the app
-- mints new codes with a CSPRNG (lib/tv.ts genPairingCode). Re-run if a rare
-- duplicate code collides.

update tvs t
set pairing_code = (
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
    '' order by g
  )
  from generate_series(1, 4) g
  where t.id is not null
);
