// READ-ONLY. Surfaces Loop Network advertiser revenue that is already in the system
// and is quietly rotting: pipeline rows nobody has touched, comps about to lapse,
// placements about to end, and venues that raised a hand.
//
//   node scripts/pipeline-mine.js
//   node scripts/pipeline-mine.js --json   # print only the JSON path
//
// Every query is a SELECT. Nothing here writes to the database.
// Writes: C:/Users/jacob/agent-ops/reports/.loop-pipeline.json

const fs = require('fs'); const path = require('path')
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '') }

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY not set in .env.local'); process.exit(1) }
const { createClient } = require('@supabase/supabase-js')
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const QUIET = process.argv.includes('--json')
const say = (...a) => { if (!QUIET) console.log(...a) }

const NOW = new Date()
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString()
const daysFromNow = n => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10)
const ageDays = ts => ts ? Math.floor((NOW - new Date(ts)) / 86400000) : null

async function main() {
  const out = { generatedAt: NOW.toISOString() }

  // 1. Open advertiser pipeline rows, with how long since anyone touched them.
  //    A row with no last_touch_at has never been worked at all.
  const { data: opps, error: oppErr } = await sb
    .from('opportunities')
    .select('id, kind, business_name, contact_name, email, phone, website, city, stage, status, monthly_cents, source, next_step, next_step_at, last_touch_at, created_at, categories(name)')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
  if (oppErr) throw oppErr

  const enrich = o => ({
    ...o,
    category: o.categories?.name || null,
    categories: undefined,
    daysSinceTouch: ageDays(o.last_touch_at),
    daysSinceCreated: ageDays(o.created_at),
    neverTouched: !o.last_touch_at,
    nextStepOverdueDays: o.next_step_at && new Date(o.next_step_at) < NOW
      ? Math.floor((NOW - new Date(o.next_step_at)) / 86400000) : null,
    reachable: !!(o.phone || o.email),
  })

  const advertisers = (opps || []).filter(o => o.kind === 'advertiser').map(enrich)
  const hosts = (opps || []).filter(o => o.kind === 'host').map(enrich)

  out.advertisers = {
    total: advertisers.length,
    neverTouched: advertisers.filter(o => o.neverTouched),
    overdue: advertisers.filter(o => o.nextStepOverdueDays !== null).sort((a, b) => b.nextStepOverdueDays - a.nextStepOverdueDays),
    goneQuiet: advertisers.filter(o => !o.neverTouched && o.daysSinceTouch !== null && o.daysSinceTouch >= 14)
      .sort((a, b) => b.daysSinceTouch - a.daysSinceTouch),
    unreachable: advertisers.filter(o => !o.reachable),
    bySource: advertisers.reduce((m, o) => { const k = o.source || 'unknown'; m[k] = (m[k] || 0) + 1; return m }, {}),
  }
  out.hosts = { total: hosts.length, neverTouched: hosts.filter(o => o.neverTouched), overdue: hosts.filter(o => o.nextStepOverdueDays !== null) }

  // 2. Placements ending in the next 30 days. A comp or a flight running out is a
  //    conversion moment, and it is invisible unless someone looks for it.
  const { data: ending } = await sb
    .from('ad_placements')
    .select('id, start_date, end_date, status, ads(name, advertiser_id, profiles:advertiser_id(business_name, email, phone)), tvs(name, venues(name))')
    .eq('status', 'active')
    .not('end_date', 'is', null)
    .lte('end_date', daysFromNow(30))
    .order('end_date', { ascending: true })
  out.endingSoon = (ending || []).map(p => ({
    end_date: p.end_date,
    daysLeft: Math.ceil((new Date(p.end_date) - NOW) / 86400000),
    ad: p.ads?.name || null,
    advertiser: p.ads?.profiles?.business_name || null,
    email: p.ads?.profiles?.email || null,
    phone: p.ads?.profiles?.phone || null,
    venue: p.tvs?.venues?.name || null,
    screen: p.tvs?.name || null,
  }))

  // 3. Advertisers with NO active placement right now: they signed up, or ran once,
  //    and are currently dark. Cheapest revenue in the building.
  const { data: allPlacements } = await sb.from('ad_placements').select('status, ads(advertiser_id)')
  const activeAdvertiserIds = new Set((allPlacements || []).filter(p => p.status === 'active').map(p => p.ads?.advertiser_id).filter(Boolean))
  const everAdvertiserIds = new Set((allPlacements || []).map(p => p.ads?.advertiser_id).filter(Boolean))
  const lapsedIds = [...everAdvertiserIds].filter(id => !activeAdvertiserIds.has(id))
  if (lapsedIds.length) {
    const { data: lapsed } = await sb.from('profiles').select('id, business_name, email, phone, created_at').in('id', lapsedIds)
    out.lapsedAdvertisers = (lapsed || []).map(p => ({ ...p, daysSinceCreated: ageDays(p.created_at) }))
  } else out.lapsedAdvertisers = []

  // 4. Venues that raised a hand and are still sitting in the waitlist.
  const { data: waitlist } = await sb.from('venue_waitlist').select('*').order('created_at', { ascending: true })
  out.venueWaitlist = (waitlist || []).map(v => ({ ...v, daysWaiting: ageDays(v.created_at) }))

  // 5. Live venues, so outreach can name the actual screens near a prospect.
  //    The live flag is `status` (venue_status enum), not an is_active boolean.
  const { data: venues, error: vErr } = await sb
    .from('venues').select('id, name, city, address, status').eq('status', 'active')
  if (vErr) throw vErr
  out.liveVenues = venues || []

  say(`\nLOOP NETWORK PIPELINE (read-only)  ${NOW.toISOString().slice(0, 10)}`)
  say(`advertiser rows open: ${out.advertisers.total}`)
  say(`  never touched:      ${out.advertisers.neverTouched.length}`)
  say(`  next step overdue:  ${out.advertisers.overdue.length}`)
  say(`  quiet 14d+:         ${out.advertisers.goneQuiet.length}`)
  say(`  no phone/email:     ${out.advertisers.unreachable.length}`)
  say(`  by source: ${JSON.stringify(out.advertisers.bySource)}`)
  say(`host rows open:       ${out.hosts.total} (${out.hosts.neverTouched.length} never touched)`)
  say(`placements ending 30d: ${out.endingSoon.length}`)
  for (const p of out.endingSoon) say(`   ${p.end_date} (${p.daysLeft}d) ${p.advertiser || '?'} @ ${p.venue || '?'}`)
  say(`lapsed advertisers:   ${out.lapsedAdvertisers.length}`)
  say(`venue waitlist:       ${out.venueWaitlist.length}`)
  say(`live venues:          ${out.liveVenues.length}`)

  const file = 'C:/Users/jacob/agent-ops/reports/.loop-pipeline.json'
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(file)
}
main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1) })
