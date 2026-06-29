-- Lets an advertiser choose which corner the scan QR sits in on their ad.
-- Defaults to 'bottom-right' to match the previously hard-coded TV overlay, so
-- every existing ad keeps its current placement until the advertiser changes it.
alter table ads
  add column if not exists qr_position text not null default 'bottom-right'
  check (qr_position in ('top-left', 'top-right', 'bottom-left', 'bottom-right'));
