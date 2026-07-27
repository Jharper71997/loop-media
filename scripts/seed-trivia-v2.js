// Replaces the trivia question pool with material that's actually worth looking up
// from a barstool, and retires the schoolroom filler that shipped with the game.
//
// Why: the original 74 questions were grade-school general knowledge ("How many
// seconds are in a minute?"). Nobody scans a QR to answer that. Three changes:
//   1. NEW GLOBAL questions built on surprise — the answer should make someone at
//      the table say "no way" and argue about it. That argument is the product.
//   2. NEW LOCAL questions scoped to the Jacksonville / Camp Lejeune territory
//      (NC oddities, Onslow County, Marine Corps). A local question beats a good
//      general one every time — people answer what they recognize.
//   3. RETIRES the dullest existing rows (active = false, nothing deleted) so the
//      pool stops serving them. Flip `active` back on in SQL to undo.
//
// Every question is 4 choices, one correct, distractors that are actually plausible
// (a question with three obviously-wrong options isn't a question). Nothing here
// goes stale: no "current champion", no "this year's" anything.
//
//   node scripts/seed-trivia-v2.js            # dry run — prints the plan, writes nothing
//   node scripts/seed-trivia-v2.js --apply    # writes to the DB
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// The Jacksonville / Camp Lejeune market — every live venue sits in it today.
// Local questions are scoped here so another territory never sees them.
const JACKSONVILLE_TERRITORY = 'ad9398a8-845f-45da-bb51-2c9a6a29ca67'

// --- New questions -------------------------------------------------------------
// [prompt, [4 choices], correct index]

const GLOBAL = [
  ['Which food never spoils?', ['Honey', 'White rice', 'Dried beans', 'Canned tuna'], 0],
  ['How many hearts does an octopus have?', ['One', 'Two', 'Three', 'Four'], 2],
  ['What is a group of crows called?', ['A murder', 'A pack', 'A gaggle', 'A rookery'], 0],
  ['Which planet spins backwards compared to the others?', ['Mars', 'Venus', 'Neptune', 'Saturn'], 1],
  [
    'What was the first product ever scanned by a barcode?',
    ['Coca-Cola', "Wrigley's gum", 'Campbell’s soup', 'Marlboro cigarettes'],
    1,
  ],
  ['The shortest war in history lasted about how long?', ['38 minutes', 'Three days', 'Two weeks', 'Six months'], 0],
  ['Which letter appears in no US state name?', ['Q', 'Z', 'X', 'J'], 0],
  ['Botanically, which of these is a berry?', ['Strawberry', 'Banana', 'Raspberry', 'Cherry'], 1],
  ['What is the dot over a lowercase "i" called?', ['A tittle', 'A serif', 'A pip', 'A jot'], 0],
  [
    'Which is the only mammal that can truly fly?',
    ['Bat', 'Flying squirrel', 'Sugar glider', 'Colugo'],
    0,
  ],
  ['What does "Wi-Fi" officially stand for?', ['Wireless Fidelity', 'Wireless Frequency', 'Nothing at all', 'Wired-Free'], 2],
  ['How many time zones does China have?', ['One', 'Three', 'Five', 'Eight'], 0],
  ['What color is a polar bear’s skin?', ['White', 'Pink', 'Black', 'Gray'], 2],
  ['How long does sunlight take to reach Earth?', ['8 seconds', '8 minutes', '8 hours', '8 days'], 1],
  ['Which of these has blue blood?', ['Octopus', 'Dolphin', 'Shark', 'Tuna'], 0],
  ['Which was invented first?', ['The fax machine', 'The telephone', 'The light bulb', 'The radio'], 0],
  ['Sharks are older than which of these?', ['Trees', 'Fish', 'Insects', 'Bacteria'], 0],
  ['What temperature reads the same in Fahrenheit and Celsius?', ['-40 degrees', '0 degrees', '32 degrees', '100 degrees'], 0],
  ['Which is the fastest bird on Earth?', ['Peregrine falcon', 'Golden eagle', 'Swift', 'Ostrich'], 0],
  ['Buffalo wings are named after a city in which state?', ['Texas', 'New York', 'Wisconsin', 'Ohio'], 1],
  ['What is traditionally served with buffalo wings?', ['Ranch', 'Blue cheese', 'Honey mustard', 'Tzatziki'], 1],
  ['After water, what is the most-consumed drink in the world?', ['Coffee', 'Tea', 'Soda', 'Juice'], 1],
  ['Which spice is the most expensive by weight?', ['Saffron', 'Vanilla', 'Cardamom', 'Black truffle salt'], 0],
  ['What makes hot peppers hot?', ['Capsaicin', 'Menthol', 'Tannin', 'Casein'], 0],
  ['What actually kills the burn from spicy food?', ['Water', 'Milk', 'Soda', 'Bread'], 1],
  ['Which country grows the most coffee?', ['Brazil', 'Colombia', 'Vietnam', 'Ethiopia'], 0],
  ['What is the highest score you can throw with three darts?', ['150', '180', '200', '501'], 1],
  ['How many players does one NFL team have on the field?', ['Ten', 'Eleven', 'Twelve', 'Thirteen'], 1],
  ['How many points is a safety worth in football?', ['One', 'Two', 'Three', 'Six'], 1],
  ['How long is a marathon?', ['24.2 miles', '26.2 miles', '28.2 miles', '30 miles'], 1],
  ['Which movie gave us the line "I’ll be back"?', ['Die Hard', 'The Terminator', 'Rocky', 'Predator'], 1],
  ['Who directed Jaws?', ['Steven Spielberg', 'George Lucas', 'Ridley Scott', 'James Cameron'], 0],
  ['Which band recorded "Bohemian Rhapsody"?', ['Queen', 'The Who', 'Led Zeppelin', 'The Beatles'], 0],
  ['What is the best-selling video game of all time?', ['Minecraft', 'Tetris', 'Grand Theft Auto V', 'Wii Sports'], 0],
  ['In Monopoly, how much do you collect for passing Go?', ['$100', '$200', '$500', '$50'], 1],
  ['What was Elvis Presley’s middle name?', ['Aaron', 'Andrew', 'Arthur', 'Alan'], 0],
  ['Which US state borders only one other state?', ['Maine', 'Florida', 'Washington', 'Rhode Island'], 0],
  ['Which US state has the most coastline?', ['Florida', 'Alaska', 'California', 'Texas'], 1],
  ['Which president is on the $50 bill?', ['Ulysses S. Grant', 'Andrew Jackson', 'Alexander Hamilton', 'Benjamin Franklin'], 0],
  ['How many ribs does the average person have?', ['Twelve', 'Twenty', 'Twenty-four', 'Thirty'], 2],
  // Second batch. The old pool is being retired wholesale, so the new one has to
  // be big enough to not repeat inside a shift — at one question a minute, ~115
  // questions is about two hours before anyone sees a repeat.
  ['Which US state has a one-syllable name?', ['Maine', 'Utah', 'Ohio', 'Texas'], 0],
  ['How many bones does a shark have?', ['None', 'Twelve', 'Sixty', 'Two hundred'], 0],
  ['What is the loudest animal on Earth?', ['Sperm whale', 'Lion', 'Howler monkey', 'Elephant'], 0],
  ['Which US coin shows a president facing right?', ['Penny', 'Nickel', 'Dime', 'Quarter'], 0],
  ['What is the most common last name in the US?', ['Smith', 'Johnson', 'Williams', 'Brown'], 0],
  ['How many dots are on a pair of dice?', ['21', '36', '42', '48'], 2],
  ['How many squares are on a chessboard?', ['36', '49', '64', '81'], 2],
  ['In poker, which hand beats a flush?', ['Full house', 'Straight', 'Three of a kind', 'Two pair'], 0],
  ['Which number is spelled with its letters in alphabetical order?', ['Forty', 'Sixty', 'Ninety', 'Thirty'], 0],
  ['Which planet has the shortest day?', ['Jupiter', 'Mercury', 'Earth', 'Mars'], 0],
  ['Which is the hottest planet in the solar system?', ['Mercury', 'Venus', 'Mars', 'Jupiter'], 1],
  ['What is the fastest fish in the ocean?', ['Sailfish', 'Great white shark', 'Tuna', 'Marlin'], 0],
  ['Which animal sleeps the most each day?', ['Koala', 'Sloth', 'House cat', 'Bear'], 0],
  ['What do you call a group of flamingos?', ['A flamboyance', 'A flock', 'A parade', 'A blush'], 0],
  ['About how much of Earth’s surface is water?', ['50%', '61%', '71%', '85%'], 2],
  ['Which country has the most islands?', ['Sweden', 'Indonesia', 'Philippines', 'Canada'], 0],
  ['Which language has the most total speakers worldwide?', ['English', 'Mandarin Chinese', 'Spanish', 'Hindi'], 0],
  ['Which state was the first admitted to the Union?', ['Delaware', 'Virginia', 'Massachusetts', 'Pennsylvania'], 0],
  ['Which amendment protects freedom of speech?', ['The First', 'The Second', 'The Fourth', 'The Fifth'], 0],
  ['How many keys are on a standard piano?', ['76', '88', '96', '100'], 1],
  ['What is the best-selling album of all time?', ['Thriller', 'Back in Black', 'The Dark Side of the Moon', 'Hotel California'], 0],
  ['Which nut is marzipan made from?', ['Almond', 'Walnut', 'Cashew', 'Pecan'], 0],
  ['What is the main ingredient in hummus?', ['Chickpeas', 'Lentils', 'White beans', 'Green peas'], 0],
  ['Which fruit carries its seeds on the outside?', ['Strawberry', 'Blueberry', 'Grape', 'Kiwi'], 0],
  ['What is the largest desert in the world?', ['Antarctica', 'The Sahara', 'The Gobi', 'The Arabian'], 0],
  ['How many time zones does Russia have?', ['Eleven', 'Seven', 'Nine', 'Fifteen'], 0],
  ['What is the smallest country in the world?', ['Vatican City', 'Monaco', 'San Marino', 'Malta'], 0],
  ['Which US state has the most active volcanoes?', ['Alaska', 'Hawaii', 'California', 'Washington'], 0],
  ['What is the deepest point in the ocean called?', ['The Mariana Trench', 'The Puerto Rico Trench', 'The Java Trench', 'The Tonga Trench'], 0],
  ['What color are airplane "black boxes"?', ['Orange', 'Black', 'Yellow', 'Red'], 0],
  ['Which country gets the most tourists each year?', ['France', 'The United States', 'Spain', 'Italy'], 0],
  ['How many strings does a bass guitar usually have?', ['Four', 'Five', 'Six', 'Seven'], 0],
  ['Which decade did the first Star Wars movie come out?', ['The 1970s', 'The 1960s', 'The 1980s', 'The 1990s'], 0],
  ['Who played Jack in Titanic?', ['Leonardo DiCaprio', 'Brad Pitt', 'Matt Damon', 'Johnny Depp'], 0],
  ['Which superhero is from the planet Krypton?', ['Superman', 'Batman', 'Iron Man', 'Thor'], 0],
  ['What is the only sport ever played on the moon?', ['Golf', 'Baseball', 'Tennis', 'Soccer'], 0],
  ['How many players are on a basketball court at once?', ['Ten', 'Eight', 'Twelve', 'Fourteen'], 0],
  ['Which animal has fingerprints almost identical to a human’s?', ['Koala', 'Chimpanzee', 'Gorilla', 'Orangutan'], 0],
  ['What year did humans first walk on the moon?', ['1969', '1965', '1972', '1959'], 0],
  ['A lightning bolt is how hot compared to the sun’s surface?', ['About five times hotter', 'About half as hot', 'About the same', 'Ten times cooler'], 0],
  ['In hockey, a hat trick is three what?', ['Goals', 'Assists', 'Penalties', 'Saves'], 0],
  ['How many minutes are on the clock in an NFL game?', ['48', '60', '72', '90'], 1],
]

const LOCAL_NC = [
  ['Pepsi was invented in which North Carolina city?', ['New Bern', 'Raleigh', 'Wilmington', 'Charlotte'], 0],
  ['What was Pepsi originally called?', ["Brad’s Drink", 'Carolina Cola', 'Doc’s Soda', 'Tar Heel Fizz'], 0],
  ['Texas Pete hot sauce is actually made in which state?', ['Texas', 'North Carolina', 'Louisiana', 'Tennessee'], 1],
  ['Cheerwine was created in which NC city?', ['Salisbury', 'Asheville', 'Durham', 'Greensboro'], 0],
  ['Krispy Kreme opened its first shop in which NC city?', ['Winston-Salem', 'Charlotte', 'Raleigh', 'Fayetteville'], 0],
  ['What is North Carolina’s official state beverage?', ['Sweet tea', 'Milk', 'Pepsi', 'Cheerwine'], 1],
  ['Which town is the county seat of Onslow County?', ['Jacksonville', 'Swansboro', 'Richlands', 'Holly Ridge'], 0],
  ['Which river does Jacksonville, NC sit on?', ['New River', 'Cape Fear River', 'Neuse River', 'White Oak River'], 0],
  ['The Wright brothers first flew at which NC spot?', ['Kitty Hawk', 'Nags Head', 'Cape Hatteras', 'Beaufort'], 0],
  ['Blackbeard was killed off which NC island?', ['Ocracoke', 'Bald Head', 'Topsail', 'Roanoke'], 0],
  ['Which NBA legend grew up in Wilmington, NC?', ['Michael Jordan', 'Chris Paul', 'Steph Curry', 'James Worthy'], 0],
  ['What is North Carolina’s nickname?', ['The Tar Heel State', 'The Palmetto State', 'The Old Dominion', 'The Peach State'], 0],
  ['Bear Island at Hammocks Beach State Park is reached how?', ['By ferry', 'By bridge', 'By tunnel', 'By causeway'], 0],
  ['Swansboro, NC calls itself what?', ['The Friendly City by the Sea', 'The Crystal Coast Capital', 'Little Washington', 'The Riverfront City'], 0],
  ['Which of these towns is on Topsail Island?', ['Surf City', 'Emerald Isle', 'Atlantic Beach', 'Sneads Ferry'], 0],
  ['Which city is home to the Carolina Panthers?', ['Charlotte', 'Raleigh', 'Greensboro', 'Durham'], 0],
  ['What is the capital of North Carolina?', ['Raleigh', 'Charlotte', 'Greensboro', 'Durham'], 0],
  ['Whose teams are the Tar Heels?', ['UNC', 'Duke', 'NC State', 'Wake Forest'], 0],
  ['Which is the tallest lighthouse in the United States?', ['Cape Hatteras', 'Bodie Island', 'Currituck Beach', 'Ocracoke'], 0],
]

const LOCAL_USMC = [
  ['Camp Lejeune is named after which Marine?', ['John A. Lejeune', 'Chesty Puller', 'Dan Daly', 'Smedley Butler'], 0],
  ['John A. Lejeune was which Commandant of the Marine Corps?', ['11th', '12th', '13th', '14th'], 2],
  ['What year was Camp Lejeune established?', ['1918', '1941', '1950', '1962'], 1],
  ['When is the Marine Corps birthday?', ['July 4, 1776', 'November 10, 1775', 'June 14, 1775', 'December 7, 1941'], 1],
  ['The Marine Corps was founded in what kind of place?', ['A tavern', 'A church', 'A courthouse', 'A shipyard'], 0],
  ['What does "Semper Fidelis" mean?', ['Always Faithful', 'Always Ready', 'First to Fight', 'Death Before Dishonor'], 0],
  ['Which battle earned Marines the nickname "Devil Dogs"?', ['Belleau Wood', 'Iwo Jima', 'Chosin Reservoir', 'Guadalcanal'], 0],
  ['What breed is the Marine Corps mascot?', ['English bulldog', 'German shepherd', 'Boxer', 'Labrador'], 0],
  ['Recruits east of the Mississippi train at which depot?', ['Parris Island', 'San Diego', 'Quantico', 'Great Lakes'], 0],
  ['The Marine Corps falls under which department?', ['The Department of the Navy', 'The Department of the Army', 'The Department of the Air Force', 'Its own department'], 0],
  ['The Beirut Memorial in Jacksonville reads "They came in ___"', ['peace', 'force', 'honor', 'silence'], 0],
  ['Which air station sits on Camp Lejeune?', ['MCAS New River', 'MCAS Cherry Point', 'MCAS Beaufort', 'MCAS Miramar'], 0],
  ['What three things make up the Marine Corps emblem?', ['Eagle, globe and anchor', 'Eagle, sword and anchor', 'Globe, anchor and star', 'Eagle, globe and sword'], 0],
  ['Marines say "Oorah." Which branch says "Hooyah"?', ['Navy', 'Army', 'Air Force', 'Coast Guard'], 0],
  ['Chesty Puller earned a record how many Navy Crosses?', ['Three', 'Four', 'Five', 'Six'], 2],
]

// --- Retiring the old pool -----------------------------------------------------
// Every pre-existing question goes inactive, not just the worst ones. They were all
// the same flavor of grade-school general knowledge, and keeping the "decent" half
// would just dilute the new pool — a good question competing with "How many feet
// are in a yard?" still loses the room. Nothing is deleted: this flips active to
// false, so `update trivia_questions set active = true where created_at < '<date>'`
// puts them all back.
const RETIRE_ALL_EXISTING = true

function env() {
  const file = path.join(__dirname, '..', '.env.local')
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const e = env()
  const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY)

  const raw = [
    ...GLOBAL.map(([prompt, choices, correct_idx]) => ({
      prompt,
      choices,
      correct_idx,
      territory_id: null,
      venue_id: null,
    })),
    ...[...LOCAL_NC, ...LOCAL_USMC].map(([prompt, choices, correct_idx]) => ({
      prompt,
      choices,
      correct_idx,
      territory_id: JACKSONVILLE_TERRITORY,
      venue_id: null,
    })),
  ]

  // Spread the correct answer across A/B/C/D. Written straight through, the right
  // answer lands on A almost every time (it's the one you think of first) — and a
  // regular who notices that stops reading the choices and just taps A. Each
  // question gets a round-robin target slot, swapping the correct choice with
  // whatever sits there.
  //
  // Exception: sequences that READ in order (years, dollar amounts, One/Two/Three)
  // are left alone. Shuffling "1918 / 1941 / 1950 / 1962" out of order looks broken,
  // and those already fall across different slots on their own.
  const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'twenty', 'twenty-four', 'thirty']
  const isOrdered = (choices) =>
    choices.every((c) => /^[^A-Za-z]*\d/.test(c)) ||
    choices.every((c) => NUMBER_WORDS.includes(c.toLowerCase()))

  let slot = 0
  const rows = raw.map((r) => {
    if (isOrdered(r.choices)) return r
    const target = slot++ % 4
    if (target === r.correct_idx) return r
    const choices = [...r.choices]
    ;[choices[target], choices[r.correct_idx]] = [choices[r.correct_idx], choices[target]]
    return { ...r, choices, correct_idx: target }
  })

  // Sanity: 4 choices, a valid answer index, no duplicate choices, no duplicate
  // prompts against what's already live. A bad row here shows on a wall in a bar.
  const { data: existing } = await sb.from('trivia_questions').select('id, prompt, active')
  const have = new Set((existing ?? []).map((q) => q.prompt.replace(/\s+/g, ' ').trim()))
  const problems = []
  for (const r of rows) {
    if (r.choices.length !== 4) problems.push(`${r.prompt} — ${r.choices.length} choices`)
    if (r.correct_idx < 0 || r.correct_idx > 3) problems.push(`${r.prompt} — bad correct_idx`)
    if (new Set(r.choices).size !== 4) problems.push(`${r.prompt} — duplicate choices`)
    if (have.has(r.prompt)) problems.push(`${r.prompt} — already in the pool`)
  }
  if (problems.length) {
    console.error('Refusing to run — fix these first:')
    problems.forEach((p) => console.error('  ' + p))
    process.exit(1)
  }

  const answerSpread = [0, 1, 2, 3].map((i) => rows.filter((r) => r.correct_idx === i).length)
  // Captured BEFORE the insert so retiring "everything that was here" can't catch
  // the rows this run is adding.
  const retireIds = RETIRE_ALL_EXISTING
    ? (existing ?? []).filter((q) => q.active).map((q) => q.id)
    : []

  console.log(`New questions:      ${rows.length}`)
  console.log(`  global:           ${GLOBAL.length}`)
  console.log(`  Jacksonville NC:  ${LOCAL_NC.length}`)
  console.log(`  Marine Corps:     ${LOCAL_USMC.length}`)
  console.log(`Answer spread A/B/C/D: ${answerSpread.join(' / ')}`)
  console.log(`Currently active:   ${(existing ?? []).filter((q) => q.active).length}`)
  console.log(`Retiring (active=false): ${retireIds.length}`)
  console.log(`Active pool after:  ${rows.length}`)

  if (!apply) {
    console.log('\n--- every question, as it will appear ---')
    for (const r of rows) {
      const shown = r.choices.map((c, i) => `${'ABCD'[i]}. ${c}`).join('   ')
      console.log(`${r.territory_id ? '[local]  ' : '[global] '}${r.prompt}\n          ${shown}   => ${'ABCD'[r.correct_idx]}`)
    }
    console.log('\nDry run. Nothing written. Re-run with --apply to write.')
    return
  }

  const { error: insErr } = await sb.from('trivia_questions').insert(rows)
  if (insErr) throw insErr
  console.log(`\nInserted ${rows.length}.`)

  if (retireIds.length) {
    const { error: retErr, count } = await sb
      .from('trivia_questions')
      .update({ active: false }, { count: 'exact' })
      .in('id', retireIds)
    if (retErr) throw retErr
    console.log(`Retired ${count ?? retireIds.length}.`)
  }

  const { data: after } = await sb.from('trivia_questions').select('active')
  console.log(`Active pool now:    ${(after ?? []).filter((q) => q.active).length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
