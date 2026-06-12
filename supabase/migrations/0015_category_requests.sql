-- Loop Network — "Other" category requests from advertisers.
--
-- When an advertiser's business type isn't in the catalog they describe it and
-- it lands here for an admin to approve (which creates the real category) or
-- dismiss. Keeps the public category list curated.
--
-- Idempotent.

create table if not exists category_requests (
  id            uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references profiles(id) on delete cascade,
  proposed_name text not null,
  status        text not null default 'pending', -- pending | approved | dismissed
  created_at    timestamptz not null default now()
);
create index if not exists idx_category_requests_status on category_requests(status);

alter table category_requests enable row level security;
-- Advertisers create + see their own requests.
do $$ begin
  create policy catreq_owner on category_requests for all to authenticated
    using (advertiser_id = auth.uid()) with check (advertiser_id = auth.uid());
exception when duplicate_object then null; end $$;
-- Admins manage every request.
do $$ begin
  create policy catreq_admin on category_requests for all to authenticated
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;
