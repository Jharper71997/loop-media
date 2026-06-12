-- Loop Network — structured US address parts on venues.
--
-- Freeform single-line addresses geocoded badly (an Indiana home resolved to
-- California) because the lookup had no city/state/country to disambiguate.
-- Store the parts so geocoding is structured + US-scoped and re-runs reliably
-- when an address is edited. `address` stays as the street line for display.
--
-- Idempotent.

alter table venues add column if not exists city text;
alter table venues add column if not exists state text;
alter table venues add column if not exists postal_code text;
