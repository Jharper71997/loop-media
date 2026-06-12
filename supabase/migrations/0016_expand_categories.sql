-- Loop Media — expand the venue category catalog.
--
-- 0003_seed only seeded 8 categories for the Crown Point demo. Hosts register in
-- any city and need a real, broad list to classify their space. This adds the
-- full catalog. Idempotent: guarded on the unique slug.

insert into categories (name, slug) values
  -- Food & drink
  ('Restaurant',              'restaurant'),
  ('Fast Food / Quick Serve', 'fast_food'),
  ('Pizzeria',                'pizzeria'),
  ('Cafe / Bakery',           'cafe_bakery'),
  ('Coffee Shop',             'coffee'),
  ('Bar / Nightlife',         'bar'),
  ('Brewery',                 'brewery'),
  ('Winery / Tasting Room',   'winery'),
  ('Hookah Lounge',           'hookah'),
  -- Fitness & recreation
  ('Gym / Fitness',           'gym'),
  ('Yoga / Pilates Studio',   'yoga'),
  ('Martial Arts / MMA',      'martial_arts'),
  ('Dance Studio',            'dance'),
  ('Golf / Country Club',     'golf'),
  ('Bowling Alley',           'bowling'),
  ('Arcade / Family Fun',     'arcade'),
  ('Pool Hall / Billiards',   'billiards'),
  -- Personal care
  ('Barber Shop',             'barber'),
  ('Hair / Beauty Salon',     'salon'),
  ('Nail Salon',              'nail_salon'),
  ('Spa / Massage',           'spa'),
  ('Med Spa / Aesthetics',    'med_spa'),
  ('Tanning Salon',           'tanning'),
  ('Tattoo Shop',             'tattoo'),
  -- Automotive
  ('Auto Repair',             'auto_repair'),
  ('Oil Change / Quick Lube', 'oil_change'),
  ('Tire Shop',               'tire_shop'),
  ('Car Wash',                'car_wash'),
  ('Car Dealership',          'dealership'),
  -- Retail & services
  ('Convenience Store',       'convenience'),
  ('Liquor Store',            'liquor_store'),
  ('Grocery / Market',        'grocery'),
  ('Smoke Shop',              'smoke_shop'),
  ('Cannabis Dispensary',     'dispensary'),
  ('Pharmacy',                'pharmacy'),
  ('Laundromat',              'laundromat'),
  ('Dry Cleaner',             'dry_cleaner'),
  ('Retail / Boutique',       'retail'),
  ('Pet Store / Grooming',    'pet'),
  -- Health & professional
  ('Veterinary Clinic',       'vet'),
  ('Medical / Doctor Office',  'medical'),
  ('Dental Office',           'dental'),
  ('Urgent Care',             'urgent_care'),
  ('Chiropractor',            'chiropractor'),
  -- Hospitality & other
  ('Hotel / Motel',           'hotel'),
  ('Real Estate Office',      'real_estate'),
  ('Bank / Credit Union',     'bank')
on conflict (slug) do nothing;
