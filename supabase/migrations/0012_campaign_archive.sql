-- Loop Network — archive (past campaigns) for advertisers.
--
-- Archiving ENDS a campaign (stops it running + billing, like cancel) and tucks
-- it into the advertiser's "Past campaigns" history, where they can review how
-- it performed. A non-null archived_at means "in Past campaigns". This is
-- separate from deleted_at (Trash = delete/restore); a campaign is in at most
-- one of the two.
--
-- Idempotent.

alter table campaigns add column if not exists archived_at timestamptz;
create index if not exists idx_campaigns_archived_at on campaigns(archived_at);
