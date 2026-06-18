-- Network / provisioning details for a venue's Loop Network Pi, captured at host
-- signup so we can program the device (WiFi etc.) before shipping it.
--
-- Kept in a SEPARATE table from `venues` on purpose: the WiFi password is a
-- secret. This table is left with RLS enabled and NO policies, so only the
-- service role (which bypasses RLS) can read or write it. Advertiser- and
-- host-facing venue queries physically cannot reach these columns.

create table if not exists public.venue_provisioning (
  venue_id      uuid primary key references public.venues(id) on delete cascade,
  wifi_ssid     text,
  wifi_password text,
  network_type  text default 'wifi',  -- 'wifi' | 'ethernet'
  network_note  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.venue_provisioning enable row level security;
-- Intentionally no policies: service role only.
