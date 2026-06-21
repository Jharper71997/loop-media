-- Reusable, host-visible pairing codes.
--
-- Before: a pairing code was 'LM-XXXXXX' and was CONSUMED (set to null) the moment
-- a screen paired, so a host could never re-view it and re-adding a screen needed
-- an admin to regenerate a brand-new code.
--
-- After (app change in this same branch): the code is the screen's permanent key
-- — pairing keeps it, the host dashboard always shows it, and re-entering it on a
-- TV re-adds the screen. This migration brings existing rows in line: every screen
-- gets a fresh short 4-char code (incl. already-paired screens whose code was
-- nulled). pairing_code stays UNIQUE; device_id bindings are left untouched.
--
-- Note: random() is fine for this one-time backfill of a handful of rows; the app
-- mints new codes with a CSPRNG (lib/tv.ts genPairingCode).

do $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no ambiguous 0/O/1/I
  t        record;
  code     text;
begin
  for t in select id from tvs loop
    loop
      code := '';
      for i in 1..4 loop
        code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      end loop;
      -- Keep going until we land a globally-unique code.
      exit when not exists (select 1 from tvs where pairing_code = code);
    end loop;
    update tvs set pairing_code = code where id = t.id;
  end loop;
end $$;
