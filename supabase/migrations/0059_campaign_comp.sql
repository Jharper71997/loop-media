-- Manual "free week" comp for advertisers. An admin runs a campaign's ad free for
-- a fixed window; comp_until is when it stops (null = not a comp). The daily place
-- cron pauses any active campaign past its comp_until, so a comped ad comes off
-- screens on its own without anyone remembering. Idempotent, safe to re-run.
alter table public.campaigns add column if not exists comp_until timestamptz;
