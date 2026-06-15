-- Loop Network — hosts get TWO free promo slots (was three).
-- The per-TV model (Stephen's call) settled on 2 free host ad slots, always.
-- Re-defines the limit trigger function; existing host ads are untouched.

create or replace function enforce_host_promo_limit()
returns trigger language plpgsql as $$
begin
  if new.owner_kind = 'host' and new.status <> 'rejected' then
    if (select count(*) from ads
          where owner_user_id = new.owner_user_id
            and owner_kind   = 'host'
            and status      <> 'rejected'
            and id          <> new.id) >= 2 then
      raise exception 'Host promo limit reached (max 2 slots)';
    end if;
  end if;
  return new;
end; $$;
