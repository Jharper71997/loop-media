// Read-only: find auth users whose email or full_name matches a substring.
//   node scripts/find-user.js "Nathan"
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
  const q = (process.argv[2] || '').toLowerCase()
  if (!q) { console.error('Usage: node scripts/find-user.js <name-or-email-substring>'); process.exit(1) }
  const env = loadEnv()
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })

  const matches = []
  for (let page = 1; ; page++) {
    const { data: list, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const u of list.users) {
      const name = (u.user_metadata && u.user_metadata.full_name) || ''
      if ((u.email || '').toLowerCase().includes(q) || name.toLowerCase().includes(q)) matches.push(u)
    }
    if (list.users.length < 1000) break
  }

  if (!matches.length) { console.log(`No auth users match "${q}"`); return }
  for (const u of matches) {
    const name = (u.user_metadata && u.user_metadata.full_name) || '(no name)'
    console.log(`${u.email}  |  ${name}  |  role=${(u.user_metadata||{}).role||'?'}  |  ${u.email_confirmed_at ? 'CONFIRMED' : 'NOT CONFIRMED'}`)
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
