-- Loop Network — Postgres-backed rate limiting
--
-- The app shipped with ZERO request throttling anywhere (no Redis/Upstash in the
-- stack — Postgres only). This adds a tiny fixed-window counter used to protect the
-- abusable anonymous endpoints (TV pairing, play/heartbeat, trivia, QR redirect).
-- Callers go through the security-definer check_rate_limit() RPC, so anon/service
-- callers never touch the table directly.
--
-- Fail-open by design: the app helper (lib/rateLimit.ts) treats any error as
-- "allowed", so a limiter problem can never take screens offline.
--
-- Idempotent, safe to re-run. Apply via the Supabase SQL editor or
-- `scripts/apply-migrations.js`.

create table if not exists rate_limits (
  bucket       text        not null,
  key          text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (bucket, key, window_start)
);

alter table rate_limits enable row level security;
-- No policies on purpose: only the security-definer RPC and the service role touch
-- this table; authenticated/anon clients have no direct access.

-- Atomically bump the counter for (bucket, key) in the current fixed window and
-- report whether the request is still within budget. Also prunes this key's stale
-- windows on the way through, so the table self-cleans without a separate job.
create or replace function check_rate_limit(
  p_bucket text,
  p_key text,
  p_max int,
  p_window_secs int
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_secs) * p_window_secs
  );
  c int;
begin
  insert into rate_limits (bucket, key, window_start, count)
  values (p_bucket, p_key, w, 1)
  on conflict (bucket, key, window_start)
    do update set count = rate_limits.count + 1
  returning count into c;

  delete from rate_limits
   where bucket = p_bucket and key = p_key and window_start < w;

  return c <= p_max;
end; $$;
