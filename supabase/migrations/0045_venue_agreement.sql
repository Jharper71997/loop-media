-- Loop Network — record the host's acceptance of the Advertising Service
-- Agreement, signed (typed signature) during venue registration.
--
-- The host signs the agreement at /host/register before the venue is submitted.
-- We store WHO signed, WHEN, and WHICH version (see lib/agreement.ts
-- AGREEMENT_VERSION) so the exact text a host agreed to stays auditable even if
-- the agreement copy changes later. Nulls = a venue created before this shipped
-- (e.g. admin-created venues); backfill/re-sign as needed.
--
-- Apply via the Supabase SQL editor or scripts/apply-migrations.js, in order.

alter table venues
  add column if not exists agreement_signed_at   timestamptz,
  add column if not exists agreement_signer_name text,
  add column if not exists agreement_version     text;

comment on column venues.agreement_signed_at is
  'When the host accepted the Advertising Service Agreement at registration.';
comment on column venues.agreement_signer_name is
  'Typed signature (full name) the host entered when accepting the agreement.';
comment on column venues.agreement_version is
  'Version of the agreement the host signed (lib/agreement.ts AGREEMENT_VERSION).';
