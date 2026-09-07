// Local trivia for the FLORIDA market — the Space Coast half of the network had
// none.
//
// Why: local questions beat general ones with a bar crowd, because people answer
// what they recognise. North Carolina has 40 local questions (Onslow County, Camp
// Lejeune, NC oddities); Florida had zero, so a screen in Cocoa served nothing but
// the 104 generic questions every other market sees. Nothing is wrong with those —
// they just don't make anyone at the table turn to their friend and argue.
//
// Scoped to the Florida territory, so no other market ever sees them. The territory
// is looked up by SLUG rather than hardcoded: seed-trivia-v2.js hardcodes the old
// "Jacksonville, NC" uuid, which no longer exists since the city markets were merged
// into states, so re-running that one today would fail on the foreign key.
//
// Two flavours, because the market is the whole state but the screens are all on the
// Space Coast: questions about Brevard, the Cape and Cocoa Beach, plus Florida-wide
// ones that play anywhere in the state as the network grows.
//
// Every question is 4 choices, one correct, with distractors that are actually
// plausible — a question with three obviously-wrong options isn't a question.
// Nothing here goes stale: no "current champion", no "this year's" anything.
//
//   node scripts/seed-trivia-fl.js            # dry run — prints the plan, writes nothing
//   node scripts/seed-trivia-fl.js --apply    # writes to the DB
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const TERRITORY_SLUG = 'florida'

// --- Questions -----------------------------------------------------------------
// [prompt, [4 choices], correct index]

// The Space Coast: Brevard County, the Cape, Cocoa Beach. These are the ones that
// get a reaction in a bar in Cocoa.
const SPACE_COAST = [
  ['Cocoa Beach is home to the flagship 24-hour store of which surf shop?',
    ['Ron Jon Surf Shop', 'Quiksilver', 'Billabong', 'Hobie Surf Shop'], 0],
  ['The 1960s sitcom "I Dream of Jeannie" was set in which Florida town?',
    ['Cocoa Beach', 'Key West', 'Sarasota', 'Daytona Beach'], 0],
  ['Apollo 11 lifted off in 1969 from which Florida launch site?',
    ['Kennedy Space Center', 'Cape San Blas', 'Homestead Air Base', 'Eglin Field'], 0],
  ['Brevard County goes by which nickname?',
    ['The Space Coast', 'The Treasure Coast', 'The First Coast', 'The Forgotten Coast'], 0],
  ['Surfing great Kelly Slater grew up in which Florida town?',
    ['Cocoa Beach', 'Jupiter', 'New Smyrna Beach', 'Fort Pierce'], 0],
  ['Port Canaveral is one of the busiest ports in the world for what?',
    ['Cruise ships', 'Car imports', 'Container freight', 'Commercial fishing'], 0],
  ['Kennedy Space Center sits on which island?',
    ['Merritt Island', 'Amelia Island', 'Anna Maria Island', 'Sanibel Island'], 0],
  ['From 1963 to 1973, Cape Canaveral was renamed after which president?',
    ['John F. Kennedy', 'Dwight Eisenhower', 'Franklin Roosevelt', 'Harry Truman'], 0],
  ['The Vehicle Assembly Building at Kennedy Space Center is one of the world’s largest buildings by what measure?',
    ['Volume', 'Number of floors', 'Height', 'Roof area'], 0],
  ['Which Space Shuttle flew the program’s first mission in 1981?',
    ['Columbia', 'Challenger', 'Discovery', 'Atlantis'], 0],
  ['The Astronaut Hall of Fame sits just outside which Brevard County city?',
    ['Titusville', 'Melbourne', 'Palm Bay', 'Rockledge'], 0],
  ['Which company launches its rockets from Kennedy Space Center’s Launch Complex 39A?',
    ['SpaceX', 'Boeing', 'Lockheed Martin', 'Virgin Galactic'], 0],
  ['The Indian River, running the length of the Space Coast, is technically what?',
    ['A lagoon', 'A river', 'A canal', 'A bay'], 0],
  ['Sebastian Inlet, one of Florida’s best-known surf breaks, sits at the southern edge of which county?',
    ['Brevard', 'Volusia', 'Martin', 'Palm Beach'], 0],
  ['Which Florida county is home to Patrick Space Force Base?',
    ['Brevard', 'Duval', 'Escambia', 'Okaloosa'], 0],
  ['Cocoa Beach Pier reaches out into which body of water?',
    ['The Atlantic Ocean', 'The Gulf of Mexico', 'Mosquito Lagoon', 'Biscayne Bay'], 0],
  ['Merritt Island National Wildlife Refuge shares its land with what?',
    ['Kennedy Space Center', 'A state prison', 'An Air Force bombing range', 'Disney property'], 0],
  ['Which Brevard County city has the largest population?',
    ['Palm Bay', 'Cocoa Beach', 'Titusville', 'Rockledge'], 0],
]

// Florida-wide: plays anywhere in the state, so these keep working as the market
// grows past the Space Coast.
const FLORIDA = [
  ['What is Florida’s state capital?',
    ['Tallahassee', 'Orlando', 'Miami', 'Jacksonville'], 0],
  ['Florida is the only state that touches the Atlantic Ocean and what else?',
    ['The Gulf of Mexico', 'The Caribbean Sea', 'The Mississippi River', 'The Bahamas'], 0],
  ['Manatees, Florida’s state marine mammal, are most closely related to which animal?',
    ['The elephant', 'The walrus', 'The dolphin', 'The hippopotamus'], 0],
  ['What is Florida’s state animal?',
    ['The Florida panther', 'The alligator', 'The manatee', 'The white-tailed deer'], 0],
  ['Florida is the only place on Earth where which two animals live side by side in the wild?',
    ['Alligators and crocodiles', 'Panthers and jaguars', 'Manatees and dugongs', 'Pythons and anacondas'], 0],
  ['Which city is the oldest continuously occupied European-founded settlement in the continental US?',
    ['St. Augustine', 'Jamestown', 'Plymouth', 'Santa Fe'], 0],
  ['Gatorade was invented by researchers at which university?',
    ['University of Florida', 'Florida State', 'University of Miami', 'Auburn'], 0],
  ['The Publix supermarket chain was founded in which state?',
    ['Florida', 'Georgia', 'Alabama', 'South Carolina'], 0],
  ['Britton Hill is the highest natural point in Florida. How tall is it?',
    ['345 feet', '1,200 feet', '2,400 feet', '780 feet'], 0],
  ['The Everglades is commonly known by what nickname?',
    ['River of Grass', 'The Big Empty', 'The Green Sea', 'The Long Marsh'], 0],
  ['Florida’s spring training baseball circuit is called what?',
    ['The Grapefruit League', 'The Cactus League', 'The Citrus League', 'The Sunshine League'], 0],
  ['What is Florida’s largest city by population?',
    ['Jacksonville', 'Miami', 'Tampa', 'Orlando'], 0],
  ['The Overseas Highway connects the Florida mainland to what?',
    ['The Florida Keys', 'Amelia Island', 'Sanibel Island', 'Cape Canaveral'], 0],
  ['What is the largest lake in Florida?',
    ['Lake Okeechobee', 'Lake George', 'Lake Kissimmee', 'Lake Apopka'], 0],
  ['Weeki Wachee Springs has been famous since the 1940s for what attraction?',
    ['Live mermaid shows', 'A glass-bottom boat ride', 'Alligator wrestling', 'A cypress maze'], 0],
  ['What is Florida’s state flower?',
    ['The orange blossom', 'The magnolia', 'The hibiscus', 'The sea grape'], 0],
  ['Sanibel Island draws visitors from all over for what?',
    ['Shelling', 'Cliff diving', 'Wine tasting', 'Snow skiing'], 0],
  ['Which Florida team completed the NFL’s only perfect season?',
    ['The Miami Dolphins', 'The Tampa Bay Buccaneers', 'The Jacksonville Jaguars', 'The Orlando Rage'], 0],
  ['The Seven Mile Bridge is part of which road?',
    ['The Overseas Highway', 'The Tamiami Trail', 'Alligator Alley', 'A1A'], 0],
  ['Roughly how far is Key West from Cuba at the closest point?',
    ['About 90 miles', 'About 250 miles', 'About 30 miles', 'About 400 miles'], 0],
  ['What is Florida’s official state fruit?',
    ['The orange', 'The grapefruit', 'The key lime', 'The strawberry'], 0],
  ['Walt Disney World sits just outside which Florida city?',
    ['Orlando', 'Tampa', 'Ocala', 'Gainesville'], 0],
]

// Shuffle each question's choices so the correct answer isn't always first — the
// answer index above is written as 0 for readability, and a fixed position would be
// guessable within one night of play.
function shuffled(prompt, choices, correctIdx) {
  const correct = choices[correctIdx]
  const order = choices.map((c, i) => ({ c, r: Math.random(), i }))
  order.sort((a, b) => a.r - b.r)
  const out = order.map((o) => o.c)
  return { prompt, choices: out, correct_idx: out.indexOf(correct) }
}

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local')
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const env = loadEnv()
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: terr, error: terrErr } = await sb
    .from('territories')
    .select('id, name')
    .eq('slug', TERRITORY_SLUG)
    .maybeSingle()
  if (terrErr) throw new Error(terrErr.message)
  if (!terr) throw new Error(`No territory with slug "${TERRITORY_SLUG}". Create the market first.`)

  const all = [...SPACE_COAST, ...FLORIDA]

  // Don't double-seed: skip any prompt already present in this territory, so the
  // script is safe to re-run after adding a few more questions to the lists above.
  const { data: existing } = await sb
    .from('trivia_questions')
    .select('prompt')
    .eq('territory_id', terr.id)
  const have = new Set((existing ?? []).map((r) => r.prompt))
  const fresh = all.filter(([prompt]) => !have.has(prompt))

  const rows = fresh.map(([prompt, choices, idx]) => ({
    ...shuffled(prompt, choices, idx),
    territory_id: terr.id,
    venue_id: null,
    active: true,
  }))

  console.log(`Territory: ${terr.name} (${terr.id})`)
  console.log(`Space Coast: ${SPACE_COAST.length} · Florida-wide: ${FLORIDA.length} · total ${all.length}`)
  console.log(`Already present: ${all.length - fresh.length} · to insert: ${rows.length}`)

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to insert.\n')
    for (const r of rows.slice(0, 5))
      console.log(`  ${r.prompt}\n    ${JSON.stringify(r.choices)} -> ${r.choices[r.correct_idx]}`)
    if (rows.length > 5) console.log(`  … and ${rows.length - 5} more`)
    return
  }

  if (!rows.length) return console.log('Nothing to insert.')
  const { error } = await sb.from('trivia_questions').insert(rows)
  if (error) throw new Error(error.message)
  console.log(`\nInserted ${rows.length} Florida questions.`)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
