// Smoke test + demo seed for the advertiser flow. Creates a confirmed advertiser,
// signs in as them, and inserts an ad + campaign + subscription THROUGH THE
// USER'S OWN RLS (exactly what the app does). Idempotent: skips if the demo
// advertiser already has a campaign.
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

async function main() {
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const email = 'advertiser@loopnetwork.app'
  const password = 'LoopNetwork2026!'

  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const createRes = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Demo Advertiser', role: 'advertiser' },
  })
  if (createRes.error && !/already|registered|exists/i.test(createRes.error.message)) {
    throw createRes.error
  }

  // Sign in as the advertiser — all inserts below run under their RLS.
  const user = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const { data: auth, error: signErr } = await user.auth.signInWithPassword({ email, password })
  if (signErr) throw signErr
  const uid = auth.user.id
  console.log('Signed in as advertiser:', uid)

  const { data: existing } = await user.from('campaigns').select('id')
  if (existing && existing.length) {
    console.log('Demo advertiser already has', existing.length, 'campaign(s) — skipping insert.')
    return
  }

  const { data: terr } = await admin
    .from('territories')
    .select('id')
    .eq('slug', 'jacksonville-nc')
    .single()
  const { data: pkg } = await admin
    .from('packages')
    .select('id, target_impressions')
    .eq('tier', 'silver')
    .is('territory_id', null)
    .single()

  const { data: ad, error: adErr } = await user
    .from('ads')
    .insert({
      owner_user_id: uid,
      owner_kind: 'advertiser',
      territory_id: terr.id,
      title: 'Demo Pizzeria — Grand Opening',
      creative_type: 'image',
      status: 'pending',
      qr_target_url: 'https://example.com/grand-opening',
    })
    .select('id')
    .single()
  if (adErr) throw adErr

  const { data: camp, error: campErr } = await user
    .from('campaigns')
    .insert({
      advertiser_id: uid,
      ad_id: ad.id,
      package_id: pkg.id,
      territory_id: terr.id,
      target_impressions: pkg.target_impressions,
      status: 'active',
    })
    .select('id')
    .single()
  if (campErr) throw campErr

  const { error: subErr } = await user.from('subscriptions').insert({
    advertiser_id: uid,
    campaign_id: camp.id,
    package_id: pkg.id,
    territory_id: terr.id,
    status: 'active',
  })
  if (subErr) throw subErr

  // Read back through the advertiser's own RLS.
  const { data: mine } = await user
    .from('campaigns')
    .select('id, status, target_impressions, ad:ads(title, status)')
  console.log('Advertiser can read own campaigns:', JSON.stringify(mine, null, 2))
  console.log('\nRLS chain OK. Demo advertiser login: advertiser@loopnetwork.app / LoopNetwork2026!')
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
