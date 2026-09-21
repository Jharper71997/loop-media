// Carry out queued screen commands over the tailnet, in about a second.
//
//   node scripts/tv-command-runner.js            # run until stopped
//   node scripts/tv-command-runner.js --once     # one pass, for a cron or a test
//   node scripts/tv-command-runner.js --dry      # say what it would do, touch nothing
//
// WHY THIS EXISTS
// The command queue (migration 0078) rides the player's 30s poll. That is the
// floor and it is worth keeping: it needs nothing installed anywhere, it works
// through any venue's NAT, and a screen that is offline does the work when it
// comes back. But it waits to be asked, and it is useless in the one case you
// most want a button for — the player itself has died, so nothing is polling.
//
// Every company-owned screen is also on the Tailscale tailnet with ADB over
// network on. That is a second path: immediate, and it does not care whether the
// player is alive, because it talks to Android rather than to the page. This
// process watches for queued commands and takes that path when it is open.
//
// It is deliberately a FAST PATH, NOT A REPLACEMENT. Anything it cannot do — no
// tailscale_host on the row, the peer offline, adb refusing — it leaves in the
// queue exactly as it found it, and the screen's own poll picks it up as before.
// The worst outcome of this process being down is the system behaving the way it
// did before this file existed.
//
// Runs wherever a Tailscale login and adb live: Jacob's workstation today.
// Needs SUPABASE_SERVICE_ROLE_KEY, read from loop-media/.env.local.

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const ROOT = path.join(__dirname, '..')
const ONCE = process.argv.includes('--once')
const DRY = process.argv.includes('--dry')
const INTERVAL_MS = 2000
// A command older than this is stale: an admin pressed it, nothing could carry
// it out, and acting on it now would be obeying an instruction from a different
// situation. Leave it for the poll (or for the operator) rather than surprising
// a venue with it.
const MAX_AGE_MS = 10 * 60 * 1000

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
for (const file of ['.env.local', '.env']) {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------
function findTool(candidates, envVar) {
  if (process.env[envVar] && fs.existsSync(process.env[envVar])) return process.env[envVar]
  for (const c of candidates) if (c && fs.existsSync(c)) return c
  return null
}

const ADB = findTool(
  [
    path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe'
    ),
    path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk/platform-tools/adb.exe'),
    '/usr/bin/adb',
    '/usr/local/bin/adb',
  ],
  'LOOP_ADB'
)

const TAILSCALE = findTool(
  ['C:/Program Files/Tailscale/tailscale.exe', '/usr/bin/tailscale', '/usr/local/bin/tailscale'],
  'LOOP_TAILSCALE'
)

function run(bin, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })
    })
  })
}

// ---------------------------------------------------------------------------
// tailnet
// ---------------------------------------------------------------------------
// Which hostnames are up right now, and at what address. Cached briefly: this is
// polled every couple of seconds and the answer does not change that fast.
let peerCache = { at: 0, peers: new Map() }

async function peers() {
  if (Date.now() - peerCache.at < 5000) return peerCache.peers
  const map = new Map()
  const r = await run(TAILSCALE, ['status', '--json'], 15000)
  if (r.ok) {
    try {
      const d = JSON.parse(r.out)
      for (const p of Object.values(d.Peer || {})) {
        const ip = (p.TailscaleIPs || []).find((a) => a.includes('.'))
        if (!ip) continue
        // Match on the MagicDNS label ("loops-7th-tv"), which is what an operator
        // sees in the Tailscale admin and what goes in the tvs column.
        const label = String(p.DNSName || '').split('.')[0].toLowerCase()
        const host = String(p.HostName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
        const entry = { ip, online: !!p.Online }
        if (label) map.set(label, entry)
        if (host) map.set(host, entry)
      }
    } catch {}
  }
  peerCache = { at: Date.now(), peers: map }
  return map
}

// ---------------------------------------------------------------------------
// the screen
// ---------------------------------------------------------------------------
const PKG = 'org.loopnetwork.kiosk'
const ACTIVITY = `${PKG}/org.loopnetwork.tv.MainActivity`

async function adb(ip, args, timeoutMs) {
  return run(ADB, ['-s', `${ip}:5555`, ...args], timeoutMs)
}

async function connect(ip) {
  await run(ADB, ['connect', `${ip}:5555`], 15000)
  const d = await run(ADB, ['devices'], 10000)
  const line = d.out.split(/\r?\n/).find((l) => l.startsWith(`${ip}:5555`))
  const state = line ? line.split(/\s+/)[1] : 'missing'
  return state === 'device' ? { ok: true } : { ok: false, state }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// Does this screen still have the kiosk on it? Decides whether a command can be
// routed THROUGH the app or has to be fired at Android directly.
async function hasKiosk(ip) {
  const r = await adb(ip, ['shell', `pm list packages ${PKG}`], 15000)
  return r.out.includes(PKG)
}

async function wakefulness(ip) {
  const r = await adb(ip, ['shell', 'dumpsys power | grep -m1 mWakefulness='], 15000)
  const m = r.out.match(/mWakefulness=(\w+)/)
  return m ? m[1] : 'unknown'
}

// Each returns the detail line that goes on the ack, or throws to leave the
// command queued for the poll.
const ACTIONS = {
  // KEYCODE_WAKEUP, then put the player back in front: after a real display-off
  // Fire OS often returns to its own launcher, and the point of waking a screen
  // is the ad, not the Amazon home row.
  async wake(ip) {
    await adb(ip, ['shell', 'input keyevent 224'], 15000)
    // Through the app again, so it re-takes the locks and clears any black
    // sheet it painted — a lit panel still showing a black rectangle is not a
    // woken screen.
    const viaApp = (await hasKiosk(ip))
      ? `am start -n ${ACTIVITY} --es lm_command wake`
      : `am start -n ${ACTIVITY}`
    await adb(ip, ['shell', viaApp], 20000)
    await pause(2000)
    const state = await wakefulness(ip)
    if (state !== 'Awake') throw new Error(`panel still ${state} after wake`)
    // Say which of the two things actually happened. A lit TV showing the Fire
    // OS home row is not the same as a lit TV showing the ad, and reporting the
    // first as the second is how a screen sits wrong for a week.
    const focus = await adb(ip, ['shell', 'dumpsys window | grep -m1 mCurrentFocus'], 15000)
    return focus.out.includes(PKG)
      ? 'woken over the tailnet; player back in front'
      : 'woken over the tailnet, but the kiosk is not in front (is it installed?)'
  },

  // Sleep has to go THROUGH the app, not around it. The kiosk holds a
  // SCREEN_BRIGHT wake lock and FLAG_KEEP_SCREEN_ON so these panels stay lit
  // 24/7; a bare keyevent turns the display off and the app lights it straight
  // back up about a second later. So: ask the shell to drop both first, then
  // send the key, then WAIT and look again. Checking immediately is how this
  // reported success twice while the screen was on.
  async sleep(ip) {
    if (await hasKiosk(ip)) {
      await adb(ip, ['shell', `am start -n ${ACTIVITY} --es lm_command sleep`], 20000)
      await pause(2000)
    }
    await adb(ip, ['shell', 'input keyevent 223'], 15000)
    await pause(6000)
    const state = await wakefulness(ip)
    if (state === 'Awake') {
      throw new Error('the panel lit itself back up (something on the screen is holding it on)')
    }
    return `panel off over the tailnet, still off six seconds later (${state})`
  },

  async relaunch(ip) {
    await adb(ip, ['shell', `am force-stop ${PKG}`], 15000)
    await adb(ip, ['shell', `am start -n ${ACTIVITY}`], 20000)
    return 'kiosk restarted over the tailnet'
  },

  // 'reload' is deliberately absent. It means "reload the page", which the
  // player does to itself perfectly well; doing it here would only cost the
  // screen its WebView state for no gain.
}

// ---------------------------------------------------------------------------
// one pass
// ---------------------------------------------------------------------------
async function pass() {
  const { data, error } = await supabase
    .from('tv_commands')
    .select('id, command, created_at, tv:tvs(id, tailscale_host, venue:venues(name))')
    .is('delivered_at', null)
    .order('created_at')
    .limit(20)
  if (error) {
    log(`queue read failed: ${error.message}`)
    return
  }
  if (!data.length) return

  const up = await peers()
  for (const c of data) {
    const label = `${c.command} -> ${c.tv?.venue?.name ?? 'unknown screen'}`
    const host = (c.tv?.tailscale_host || '').toLowerCase()
    if (!host) continue // poll-only screen: not ours to touch
    if (!ACTIONS[c.command]) continue // the player owns this one
    if (Date.now() - new Date(c.created_at).getTime() > MAX_AGE_MS) {
      log(`${label}: older than 10 minutes, leaving it for the poll`)
      continue
    }
    const peer = up.get(host)
    if (!peer || !peer.online) {
      log(`${label}: ${host} is not up on the tailnet, leaving it queued`)
      continue
    }
    if (DRY) {
      log(`${label}: WOULD run over adb at ${peer.ip}`)
      continue
    }

    const conn = await connect(peer.ip)
    if (!conn.ok) {
      log(`${label}: adb says ${conn.state} at ${peer.ip}, leaving it queued`)
      continue
    }
    try {
      const detail = await ACTIONS[c.command](peer.ip)
      // Delivered AND acked in one write: the screen never sees this command, so
      // nobody else is coming to close it out.
      await supabase
        .from('tv_commands')
        .update({
          delivered_at: new Date().toISOString(),
          acked_at: new Date().toISOString(),
          ok: true,
          detail,
        })
        .eq('id', c.id)
      log(`${label}: ${detail}`)
    } catch (e) {
      // Left queued on purpose. The screen's own poll is still coming, and a
      // command that half-worked should not read as done.
      log(`${label}: ${String(e.message || e)} — left for the poll`)
    }
  }
}

function log(msg) {
  process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${msg}\n`)
}

async function main() {
  if (!ADB) {
    log('adb not found. Set LOOP_ADB to its full path.')
    process.exit(1)
  }
  if (!TAILSCALE) {
    log('tailscale not found. Set LOOP_TAILSCALE to its full path.')
    process.exit(1)
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    log('SUPABASE_SERVICE_ROLE_KEY missing (expected in loop-media/.env.local).')
    process.exit(1)
  }
  log(`watching the command queue${DRY ? ' (dry run)' : ''}; ${ONCE ? 'one pass' : `every ${INTERVAL_MS}ms`}`)
  if (ONCE) return pass()
  for (;;) {
    await pass().catch((e) => log(`pass failed: ${String(e.message || e)}`))
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
}

main()
