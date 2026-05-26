// Creates (or promotes) a confirmed global-admin account.
//
//   node scripts/create-admin.js you@example.com "YourPassword123"
//
// Reads Supabase URL + service key from .env.local. The account is created with
// email already confirmed, so you can log in immediately.

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
  const email = process.argv[2]
  const password = process.argv[3]
  if (!email || !password) {
    console.error('Usage: node scripts/create-admin.js <email> <password>')
    process.exit(1)
  }

  const env = loadEnv()
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Loop Media Admin', role: 'admin' },
  })
  if (createErr && !/already|registered|exists/i.test(createErr.message)) {
    throw createErr
  }
  if (createErr) {
    // User already exists — confirm the email and (re)set the password so they
    // can log in without the email-confirmation link.
    let found = null
    for (let page = 1; !found; page++) {
      const { data: list, error: lErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
      if (lErr) throw lErr
      found = list.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
      if (found || list.users.length < 1000) break
    }
    if (!found) throw new Error('User exists but could not be found in listUsers')
    const { error: updErr } = await supabase.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
    })
    if (updErr) throw updErr
    console.log('User already existed — confirmed email, reset password, promoting to admin.')
  }

  // Ensure the profile is a global admin (territory_id null).
  const { error: upErr } = await supabase
    .from('profiles')
    .update({ role: 'admin', territory_id: null })
    .eq('email', email)
  if (upErr) throw upErr

  console.log(`\nDone. Log in at /login with:\n  ${email}\n  (the password you provided)`)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
