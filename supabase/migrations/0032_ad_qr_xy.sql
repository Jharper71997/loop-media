-- Free-drag QR placement: replace the 4-corner enum (0030's qr_position) with a
-- free center point stored as two fractions in [0,1] of the 16:9 ad frame. The
-- TV/preview render the QR at left = qr_x*100%, top = qr_y*100% with a
-- translate(-50%,-50%), so the advertiser can drop the scan code anywhere.
--
-- Defaults match the old 'bottom-right' corner (~0.9, 0.88) so every existing ad
-- keeps its current placement until the advertiser drags it. The old qr_position
-- column is intentionally LEFT IN PLACE for back-compat; new code stops reading it.
alter table ads add column if not exists qr_x real not null default 0.9;
alter table ads add column if not exists qr_y real not null default 0.88;
