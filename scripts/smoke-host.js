// Smoke test + demo seed for the host flow. Creates a confirmed host user,
// links one seeded Jacksonville venue to them (service role, since hosts can't
// self-assign), then signs in AS the host and reads their venue + TVs through
// the host's own RLS — exactly what /host does. Idempotent.
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
  const email = 'host@loopnetwork.app'
  const password = 'LoopNetwork2026!'

  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const createRes = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Demo Host', role: 'host' },
  })
  if (createRes.error && !/already|registered|exists/i.test(createRes.error.message)) {
    throw createRes.error
  }

  // Resolve the host uid (createUser may have returned it, else look it up).
  let uid = createRes.data?.user?.id
  if (!uid) {
    const { data: list } = await admin.auth.admin.listUsers()
    uid = list.users.find((u) => u.email === email)?.id
  }
  if (!uid) throw new Error('Could not resolve host uid')
  // Make sure the profile carries the host role (in case it pre-existed).
  await admin.from('profiles').update({ role: 'host' }).eq('id', uid)
  console.log('Host user:', uid)

  // Link the first Jacksonville venue to this host.
  const { data: terr } = await admin
    .from('territories')
    .select('id')
    .eq('slug', 'jacksonville-nc')
    .single()
  const { data: venue } = await admin
    .from('venues')
    .select('id, name, host_user_id')
    .eq('territory_id', terr.id)
    .order('name')
    .limit(1)
    .single()
  if (venue.host_user_id !== uid) {
    await admin.from('venues').update({ host_user_id: uid }).eq('id', venue.id)
  }
  console.log('Linked venue:', venue.name)

  // Read back AS the host, under their RLS.
  const host = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const { error: signErr } = await host.auth.signInWithPassword({ email, password })
  if (signErr) throw signErr
  const { data: mine } = await host
    .from('venues')
    .select('name, foot_traffic_estimate, tvs(status, pairing_code)')
    .eq('host_user_id', uid)
  console.log('Host can read own venue(s):', JSON.stringify(mine, null, 2))
  console.log('\nHost flow OK. Demo host login: host@loopnetwork.app / LoopNetwork2026!')
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
