-- Loop Network — advertiser-adjustable QR size on an ad.
--
-- The on-ad QR was drag-positioned (qr_x/qr_y from 0032) but always rendered at
-- a fixed size. Advertisers can now size it too. qr_size is the QR's width as a
-- fraction of the 16:9 frame width (e.g. 0.09 ≈ 9% of the width). Null = the
-- default (see lib/adCreative.ts QR_SIZE_DEFAULT). The QR stays a render-time
-- overlay drawn by the TV; nothing is baked into the creative.
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

alter table ads
  add column if not exists qr_size real;

comment on column ads.qr_size is
  'On-ad QR width as a fraction of the frame width (null = default); render-time overlay.';
