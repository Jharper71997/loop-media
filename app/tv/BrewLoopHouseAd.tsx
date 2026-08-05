'use client'

import { useState } from 'react'
import { BrewLoopStory } from './BrewLoopStory'
import { BrewLoopPartyStory } from './BrewLoopPartyStory'

// The Brew Loop house slide alternates between its two ads instead of showing one.
// They sell opposite halves of the same ticket and both are 15s, so running one per
// pass costs nothing and a rider sitting through two loops sees both:
//
//   BrewLoopStory       the traffic stop. Why you don't drive.
//   BrewLoopPartyStory  the night itself, the process, every partner bar.
//
// Alternation is a module counter read once per mount rather than a timestamp,
// because calling Date.now() during render is impure and the lint rules reject it
// (see the trivia countdown in TvPlayer for the same rule firing). The slide
// remounts every cycle, so "per mount" is "per loop pass".
//
// React StrictMode can run a useState initializer twice in development, which would
// skip a variant. That is invisible for an ad rotation and never happens in
// production, so it isn't worth a ref-and-effect dance to prevent.
let pass = 0

export function BrewLoopHouseAd({ qrImage }: { qrImage: string }) {
  const [which] = useState(() => pass++ % 2)
  return which === 0 ? (
    <BrewLoopStory qrImage={qrImage} />
  ) : (
    <BrewLoopPartyStory qrImage={qrImage} />
  )
}
