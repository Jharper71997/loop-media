// Read-only: look up an auth user + their profile by email.
//   node scripts/lookup-user.js someone@example.com
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

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
  const email = (process.argv[2] || '').toLowerCase()
  if (!email) { console.error('Usage: node scripts/lookup-user.js <email>'); process.exit(1) }
  const env = loadEnv()
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })

  let found = null
  for (let page = 1; ; page++) {
    const { data: list, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    found = list.users.find((u) => (u.email || '').toLowerCase() === email)
    if (found || list.users.length < 1000) break
  }

  if (!found) {
    console.log(`AUTH USER: none found for ${email}`)
  } else {
    console.log('AUTH USER:')
    console.log('  id:', found.id)
    console.log('  email:', found.email)
    console.log('  email_confirmed_at:', found.email_confirmed_at || '(NOT CONFIRMED)')
    console.log('  created_at:', found.created_at)
    console.log('  metadata:', JSON.stringify(found.user_metadata || {}))
  }

  const { data: profiles } = await supabase.from('profiles').select('*').ilike('email', email)
  if (!profiles || !profiles.length) {
    console.log('PROFILE: none')
  } else {
    for (const p of profiles) {
      console.log('PROFILE:')
      console.log('  role:', p.role, '| territory_id:', p.territory_id, '| full_name:', p.full_name)
    }
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
