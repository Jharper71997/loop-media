-- Loop Network — soft-delete (trash) for advertiser campaigns.
--
-- Deleting a campaign should never destroy it: it moves to the advertiser's
-- Trash (billing + placements stop, but the record, creative and targets stay)
-- and can be restored later. A non-null deleted_at means "in the trash".
--
-- Idempotent.

alter table campaigns add column if not exists deleted_at timestamptz;
create index if not exists idx_campaigns_deleted_at on campaigns(deleted_at);
