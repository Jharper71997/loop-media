// Send a single test email through Resend using the SAME config the app uses
// (RESEND_API_KEY + RESEND_FROM from .env.local, raw fetch to the REST API).
// Use it to prove the sending domain works end to end.
//
//   node scripts/test-resend.js                 -> sends to the default address below
//   node scripts/test-resend.js you@example.com -> sends to that address
//
// Expected while loopnetwork.org is UNVERIFIED in Resend: HTTP 403 (no mail sent).
// Expected once verified: HTTP 200 + a message id, and the mail actually lands.
const fs = require('fs')
const path = require('path')

const DEFAULT_TO = 'jharper@sharperprocess.com'

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
  const env = loadEnv()
  const key = env.RESEND_API_KEY
  const from = env.RESEND_FROM || 'Loop Network <reports@loopnetwork.org>'
  const to = process.argv[2] || DEFAULT_TO
  if (!key) { console.error('RESEND_API_KEY not set in .env.local'); process.exit(1) }

  console.log('From:', from)
  console.log('To:  ', to)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Loop Network email test',
      html: '<p>This is a Loop Network deliverability test. If you can read this, the sending domain is verified in Resend.</p>',
    }),
  })
  const body = await res.text()
  console.log('HTTP', res.status)
  console.log(body)
  process.exitCode = res.ok ? 0 : 1
}
main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1 })
