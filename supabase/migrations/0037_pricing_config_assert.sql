-- Loop Network — guarantee the pricing_config row exists
--
-- getPricingConfig() falls back to code defaults when the pricing_config "default"
-- row is missing. Historically the code fallback was a FLAT $50 while the DB seed
-- (0023) is the $75 ladder / $200 minimum — so a missing row silently billed the
-- wrong, cheaper rate. The code fallback now mirrors the seed, and this migration
-- makes the row's existence non-optional in every environment.
--
-- Non-clobbering: an existing (possibly admin-tuned) row is left untouched, so this
-- is safe to re-run and won't reset live prices. Idempotent. Apply via the Supabase
-- SQL editor or `scripts/apply-migrations.js`.

insert into pricing_config (id) values ('default')
on conflict (id) do nothing;
