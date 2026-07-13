// Ordered steps for the host first-run walkthrough. Each step optionally lives on
// a `path` (the tour navigates there before showing the step) and points at a real
// element via `anchor` (a `data-tour="…"` attribute). When the anchor isn't on the
// page — e.g. a brand-new host who hasn't registered a venue yet, so the screens/
// perk cards don't exist — the step falls back to a centered card that still
// explains the step. So the tour teaches the whole flow whether or not the host has
// set anything up yet, and reads as a true guided tour once they have.

export type TourStep = {
  // Route this step belongs to. If set and the user isn't there, the tour navigates
  // (client-side) before resolving the anchor. Omit for a path-agnostic step.
  path?: string
  // data-tour value to spotlight. Omit (or when missing at runtime) → centered card.
  anchor?: string
  title: string
  body: string
}

export const HOST_TOUR: TourStep[] = [
  {
    title: 'Welcome to Loop Network',
    body: 'You run a Loop screen in your venue. This quick tour shows how it all works. You can skip anytime.',
  },
  {
    path: '/host',
    anchor: 'host-overview',
    title: 'This is your dashboard',
    body: 'Your screens, what is playing right now, and your host perks all live here on your home tab.',
  },
  {
    path: '/host',
    anchor: 'host-register',
    title: 'Step 1: register your venue',
    body: 'Add your location so we can get your screen set up and put you on the map for advertisers.',
  },
  {
    path: '/host/register',
    anchor: 'register-form',
    title: 'Tell us about your space',
    body: 'A few quick details about your venue. Once you submit, we review it and reach out to set up your screen.',
  },
  {
    path: '/host',
    anchor: 'host-screens',
    title: 'We set up your screen',
    body: 'Setup takes about two minutes, like a Ring doorbell: plug in the Fire Stick, pair the code, and you are live.',
  },
  {
    path: '/host',
    anchor: 'host-stats',
    title: 'Watch your screen work',
    body: 'Once live, track QR scans, ads played, and trivia players from your venue, updated every day.',
  },
  {
    path: '/host',
    anchor: 'host-perk',
    title: 'Advertise your business free',
    body: 'As a host you get a code for 100% off advertising your own business across the whole network.',
  },
  {
    path: '/host/promote',
    anchor: 'promote-form',
    title: 'Put your own promo on your screen',
    body: 'Run your own image or video, a special or an event, right on your TV. It is free and plays within about 30 seconds.',
  },
]
