-- Loop Media — per-advertiser/per-campaign screen cap.
-- Lets an operator limit a single campaign to at most N screens, independent of
-- (and never exceeding) the package screen_cap. null = no extra limit.
alter table campaigns
  add column if not exists screen_cap_override int check (screen_cap_override > 0);
