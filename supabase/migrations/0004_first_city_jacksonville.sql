-- Loop Media: first launch market is Jacksonville, NC (Eastern time).
-- Renames the seeded demo territory and repositions its demo venues.
-- Append-only: on a fresh DB this runs after 0003 (which seeds Crown Point).

update territories
set name = 'Jacksonville, NC',
    slug = 'jacksonville-nc',
    timezone = 'America/New_York'
where slug = 'crown-point';

-- Reposition the demo venues into the Jacksonville, NC area (approx coords).
with terr as (select id from territories where slug = 'jacksonville-nc')
update venues v set
  name    = c.new_name,
  address = c.address,
  lat     = c.lat,
  lng     = c.lng
from (values
  ('The Tap House',        'The Tap House',         '118 Old Bridge St, Jacksonville, NC', 34.75300, -77.43100),
  ('Iron Works Gym',       'Iron Works Gym',        '2155 N Marine Blvd, Jacksonville, NC', 34.77050, -77.41350),
  ('Fade Factory Barbers', 'Fade Factory Barbers',  '330 Western Blvd, Jacksonville, NC',  34.75620, -77.40980),
  ('Region Brews Coffee',  'Coastal Grounds Coffee','200 New Bridge St, Jacksonville, NC', 34.75480, -77.42850),
  ('Crossroads Brewery',   'Riverwalk Brewing Co.', '10 Court St, Jacksonville, NC',       34.75150, -77.43250)
) as c(old_name, new_name, address, lat, lng)
where v.name = c.old_name
  and v.territory_id = (select id from terr);
