// Phase 6 verification for the placement engine — runs the REAL engine via the
// /api/cron/place route (started separately), not a reimplementation.
//
//   node scripts/smoke-placement.js prep    # approve demo ad, set its category to a
//                                            # venue's own line of business to test
//                                            # host protection, clear placements
//   <hit the cron route to run lib/placement.ts>
//   node scripts/smoke-placement.js check    # read back + assert host protection/fill
//
// NOTE: the ONLY exclusivity is host protection — a venue never runs a competitor's
// ad in its OWN line of business. Unrelated advertisers may freely share a screen.
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

function loadEnv() {
  const out = {}
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = loadEnv()
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function demoCampaign() {
  const { data: adv } = await admin.from('profiles').select('id').eq('email', 'advertiser@loopnetwork.app').single()
  const { data: camp } = await admin
    .from('campaigns')
    .select('id, ad_id, target_impressions, package_id, territory_id, status')
    .eq('advertiser_id', adv.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  return camp
}

async function prep() {
  const camp = await demoCampaign()
  // All active venues in the territory, with category + traffic + tv count.
  const { data: venues } = await admin
    .from('venues')
    .select('id, name, category_id, foot_traffic_estimate, category:categories(name), tvs(id)')
    .eq('territory_id', camp.territory_id)
    .eq('status', 'active')
    .order('foot_traffic_estimate', { ascending: false })

  // Pick the highest-traffic venue that HAS a category — make the ad that
  // category so host protection must skip that venue's screen (the ad is now in
  // the venue's own line of business).
  const top = venues.find((v) => v.category_id)
  const excludedCat = top?.category_id ?? null

  await admin
    .from('ads')
    .update({ status: 'approved', category_id: excludedCat })
    .eq('id', camp.ad_id)
  await admin.from('campaigns').update({ status: 'active' }).eq('id', camp.id)
  await admin.from('ad_placements').delete().eq('campaign_id', camp.id)

  console.log('Campaign:', camp.id, '| goal:', camp.target_impressions, 'imp | pkg:', camp.package_id ? 'silver(cap 10)' : 'custom')
  console.log('Ad category set to:', top?.category?.name ?? '(none)', '=> that venue must be EXCLUDED:', top?.name ?? '—')
  console.log('\nInventory (by traffic):')
  for (const v of venues) {
    const excl = v.category_id && v.category_id === excludedCat
    console.log(
      `  ${excl ? 'EXCLUDE' : 'eligible'}  ${v.name}  [${v.category?.name ?? 'no category'}]  ${v.foot_traffic_estimate}/mo  ${v.tvs.length} tv`
    )
  }
  console.log('\nPrepped. Now run the engine via the cron route, then: node scripts/smoke-placement.js check')
}

async function check() {
  const camp = await demoCampaign()
  const { data: ad } = await admin.from('ads').select('category_id, status, category:categories(name)').eq('id', camp.ad_id).single()
  const { data: placements } = await admin
    .from('ad_placements')
    .select('id, status, slot_position, tv:tvs(id, venue:venues(name, category_id, foot_traffic_estimate))')
    .eq('campaign_id', camp.id)
    .eq('status', 'active')

  console.log('Ad status:', ad.status, '| ad category:', ad.category?.name ?? '(none)')
  console.log('Active placements:', placements.length)
  let est = 0
  let exclusivityViolations = 0
  for (const p of placements) {
    const v = p.tv?.venue
    if (!v) continue
    est += v.foot_traffic_estimate ?? 0
    const bad = ad.category_id && v.category_id === ad.category_id
    if (bad) exclusivityViolations++
    console.log(`  ${bad ? 'VIOLATION!' : 'ok'}  ${v.name}  ${v.foot_traffic_estimate}/mo  slot ${p.slot_position}`)
  }
  console.log(`\nEst impressions: ${est} / goal ${camp.target_impressions}`)
  console.log('Host protection:', exclusivityViolations === 0 ? 'PASS (no same-line host screen)' : `FAIL (${exclusivityViolations})`)
  console.log('Placed something:', placements.length > 0 ? 'PASS' : 'FAIL (no screens)')
}

const mode = process.argv[2]
const fn = mode === 'check' ? check : mode === 'prep' ? prep : null
if (!fn) {
  console.error('Usage: node scripts/smoke-placement.js prep|check')
  process.exit(1)
}
fn().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
