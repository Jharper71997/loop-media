-- ============================================================
-- 0021_creative_queue.sql
-- Creative-help admin queue.
--
-- Advertisers can ask us to make their ad for them (creative_requests, seeded
-- from the campaign builder's "creative_help_brief"). They could already file
-- one; admins could only read them. This adds the columns + write policy the
-- admin queue needs to actually work the requests: record who handled it, a
-- note back to the advertiser, and a last-touched timestamp.
-- ============================================================

alter table creative_requests
  add column if not exists admin_note text,
  add column if not exists handled_by uuid references profiles(id),
  add column if not exists updated_at timestamptz not null default now();

-- Let admins move a request through open -> in_progress -> done and save a note.
-- creq_admin (select) already exists; this adds update/delete for admins.
drop policy if exists creq_admin_write on creative_requests;
create policy creq_admin_write on creative_requests for update to authenticated
  using (is_admin()) with check (is_admin());
