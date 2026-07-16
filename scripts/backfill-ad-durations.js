// Backfills ads.duration_seconds from each video creative's REAL length, and flags
// any spot longer than the sold slot.
//
// Why: duration_seconds has always been DB-defaulted to 15 and only ever changed by
// hand on the admin screen page — nothing ever derived it from the file. Meanwhile
// the TV player advanced videos on their native `ended`, so a 3-minute upload aired
// for 3 full minutes and held the loop while every other advertiser on that screen
// waited. The player now hard-cuts at the slot; this script makes the stored data
// agree with what actually airs, and tells you which advertisers were relying on the
// old behavior so you can warn them BEFORE their ad starts getting cut at 15s.
//
//   node scripts/backfill-ad-durations.js           # dry run — reports, writes nothing
//   node scripts/backfill-ad-durations.js --apply    # writes duration_seconds
//
// Needs ffprobe on PATH (winget's Gyan.FFmpeg build is fine) and SUPABASE_SERVICE_KEY
// in .env.local. Probes the public creative_url directly — no download to disk.
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { createClient } = require('@supabase/supabase-js')

// Mirrors MAX_SPOT_SECONDS / clampSpotSeconds in lib/adCreative.ts — that module is
// the source of truth for the app; this is a standalone CJS ops script, so the rule
// is restated rather than imported. Keep the two in step if the slot length changes.
const MAX_SPOT_SECONDS = 15
const clampSpotSeconds = (secs) =>
  !Number.isFinite(secs) || secs <= 0 ? MAX_SPOT_SECONDS : Math.min(Math.ceil(secs), MAX_SPOT_SECONDS)

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local')
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

// Real duration in seconds, or null if ffprobe can't read it (dead URL, bad codec,
// truncated file). A null is itself worth reporting — that ad probably doesn't play
// on the Fire Stick either.
function probeDuration(url) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        url,
      ],
      { timeout: 60_000 },
      (err, stdout) => {
        if (err) return resolve(null)
        const secs = parseFloat(String(stdout).trim())
        resolve(Number.isFinite(secs) && secs > 0 ? secs : null)
      }
    )
  })
}

async function main() {
  const apply = process.argv.includes('--apply')
  const env = loadEnv()
  // .env.local carries SUPABASE_SERVICE_ROLE_KEY; a couple of older scripts read
  // SUPABASE_SERVICE_KEY, so accept either rather than fail on the name.
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
  if (!serviceKey) throw new Error('No SUPABASE_SERVICE_ROLE_KEY in .env.local')
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false },
  })

  const { data: ads, error } = await supabase
    .from('ads')
    .select('id, title, status, duration_seconds, creative_url, is_demo')
    .eq('creative_type', 'video')
    .not('creative_url', 'is', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  if (!ads.length) {
    console.log('No video ads found.')
    return
  }
  console.log(`Probing ${ads.length} video ad(s)…${apply ? '' : '  (dry run)'}\n`)

  const overLength = []
  const unreadable = []
  let changed = 0

  for (const ad of ads) {
    const real = await probeDuration(ad.creative_url)
    if (real === null) {
      unreadable.push(ad)
      console.log(`  ??  ${ad.title} — ffprobe could not read this creative`)
      continue
    }
    const next = clampSpotSeconds(real)
    const over = real > MAX_SPOT_SECONDS + 0.5
    if (over) overLength.push({ ...ad, real })

    const note = over ? `  <-- ${real.toFixed(1)}s, will be CUT at ${MAX_SPOT_SECONDS}s` : ''
    console.log(
      `  ${over ? '!!' : 'ok'}  ${ad.title} — real ${real.toFixed(1)}s, stored ${ad.duration_seconds}s -> ${next}s${note}`
    )

    if (next !== ad.duration_seconds) {
      changed++
      if (apply) {
        const { error: upErr } = await supabase
          .from('ads')
          .update({ duration_seconds: next })
          .eq('id', ad.id)
        if (upErr) console.error(`      write failed: ${upErr.message}`)
      }
    }
  }

  console.log(`\n${changed} row(s) ${apply ? 'updated' : 'would change'}.`)

  if (overLength.length) {
    console.log(
      `\n${overLength.length} ad(s) run longer than the ${MAX_SPOT_SECONDS}s slot. These have been`
    )
    console.log('airing in full and holding the loop. Once the player cut ships they get')
    console.log('clipped mid-message — worth a heads-up to each advertiser first:\n')
    for (const a of overLength) {
      console.log(`  - ${a.title} (${a.real.toFixed(1)}s, ${a.status})${a.is_demo ? ' [demo]' : ''}`)
      console.log(`    ad id ${a.id}`)
    }
  }
  if (unreadable.length) {
    console.log(`\n${unreadable.length} creative(s) ffprobe could not read — likely broken on the`)
    console.log('TV too, since the Fire Stick has to decode the same file:\n')
    for (const a of unreadable) console.log(`  - ${a.title} (${a.status}) — ${a.id}`)
  }
  if (!apply && changed) console.log('\nRe-run with --apply to write.')
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
