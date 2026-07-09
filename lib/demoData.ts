// Guided-demo sample data + constants. Pure data, no server imports — safe to
// import from client components (the sign-up + register forms prefill from here).
// The server-only provisioning logic lives in lib/demo.ts.

export const DEMO_EMAIL_DOMAIN = 'demo.loopnetwork.app'

// Comp code stamped on the demo host's venue so the "advertise free" card shows.
export const DEMO_COMP_CODE = 'HOSTDEMO100'

// Prefill for the demo host's sign-up + venue registration. Believable, clearly a
// sample. City is real (Highland, IN — Jacob's area) so geocoding + the map work.
export const DEMO_HOST = {
  fullName: 'Alex Rivera',
  venueName: 'Sunrise Café',
  address: '124 Main Street',
  city: 'Highland',
  state: 'IN',
  zip: '46322',
  venueType: 'Coffee shop',
  dailyCustomers: 180,
  phone: '(219) 555-0142',
  ssid: 'Sunrise-Guest',
  wifiPassword: 'freshbrew',
} as const

// Prefill for the demo advertiser's sign-up.
export const DEMO_ADVERTISER = {
  fullName: 'Jordan Lee',
} as const
