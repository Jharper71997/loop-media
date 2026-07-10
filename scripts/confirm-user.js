// Marks an existing auth user's email as confirmed, so they can log in with the
// password they already chose at signup. Does NOT change their password or role.
//   node scripts/confirm-user.js someone@example.com
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
  if (!email) { console.error('Usage: node scripts/confirm-user.js <email>'); process.exit(1) }
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
  if (!found) throw new Error(`No auth user for ${email}`)
  if (found.email_confirmed_at) {
    console.log(`Already confirmed at ${found.email_confirmed_at} — nothing to do.`)
    return
  }

  const { error } = await supabase.auth.admin.updateUserById(found.id, { email_confirm: true })
  if (error) throw error
  console.log(`Confirmed ${email}. They can now log in at /login with their existing password.`)
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
