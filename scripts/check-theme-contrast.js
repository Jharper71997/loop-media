// Loop Network: WCAG AA contrast checker for the theme tokens.
//
//   node scripts/check-theme-contrast.js
//
// Parses the theme class blocks out of app/globals.css (the single source of
// truth), converts each OKLCH token to sRGB, and checks every foreground/
// background pairing against its required ratio: 4.5:1 for text, 3:1 for UI
// boundaries (focus ring, input field borders). Decorative `--border` (card
// edges / dividers that sit against a differing surface) is reported as
// advisory only — WCAG 1.4.11 exempts it. Exit code is non-zero if any
// REQUIRED pairing fails, so this can gate a commit / CI.
//
// Run this after retuning a theme or adding a new one; it needs no build and
// no browser. Themes are discovered automatically from their class blocks.

const fs = require('node:fs')
const path = require('node:path')

// ---- OKLCH -> sRGB (Björn Ottosson) ----------------------------------------
function oklchToSrgb(L, C, h) {
  const hr = (h * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const enc = (x) => {
    x = Math.min(1, Math.max(0, x))
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  }
  return [enc(R), enc(G), enc(B)]
}
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a))
function relLum([r, g, b]) {
  const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(c1, c2) {
  const L1 = relLum(c1), L2 = relLum(c2)
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1]
  return (hi + 0.05) / (lo + 0.05)
}

// ---- parse theme token blocks out of globals.css ---------------------------
// Returns { tokenName: [L, C, H, alpha?] } for one CSS class block.
function parseBlock(css, selectorRe) {
  const start = css.search(selectorRe)
  if (start === -1) return null
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open) // theme blocks have no nested braces
  const body = css.slice(open + 1, close)
  const tokens = {}
  const re = /--([\w-]+):\s*oklch\(([^)]+)\)/g
  let match
  while ((match = re.exec(body))) {
    const [name, raw] = [match[1], match[2]]
    const [color, alpha] = raw.split('/').map((s) => s.trim())
    const [L, C = 0, H = 0] = color.split(/\s+/).map(Number)
    const t = [L, C, H]
    if (alpha) t.push(parseFloat(alpha) / (alpha.includes('%') ? 100 : 1))
    tokens[name] = t
  }
  return tokens
}

const cssPath = path.join(__dirname, '..', 'app', 'globals.css')
const css = fs.readFileSync(cssPath, 'utf8')
const THEMES = {
  dark: parseBlock(css, /\.dark\s*\{/), // the `:root, .dark {` block
  light: parseBlock(css, /\.light\s*\{/),
}

function rgbOf(pal, name, bgName) {
  const v = pal[name]
  if (!v) throw new Error(`token --${name} not found`)
  const base = oklchToSrgb(v[0], v[1], v[2])
  return v.length === 4 ? over(base, v[3], oklchToSrgb(...pal[bgName].slice(0, 3))) : base
}

const TEXT = 4.5, UI = 3.0
const PAIRS = [
  ['foreground', 'background', TEXT, 'body text on page'],
  ['muted-foreground', 'background', TEXT, 'secondary text on page'],
  ['muted-foreground', 'muted', TEXT, 'muted text on muted'],
  ['card-foreground', 'card', TEXT, 'text on card'],
  ['popover-foreground', 'popover', TEXT, 'text on popover'],
  ['primary-foreground', 'primary', TEXT, 'label on primary button'],
  ['secondary-foreground', 'secondary', TEXT, 'label on secondary button'],
  ['accent-foreground', 'accent', TEXT, 'label on accent'],
  ['destructive-foreground', 'destructive', TEXT, 'label on destructive'],
  ['success-foreground', 'success', TEXT, 'label on success'],
  ['warning-foreground', 'warning', TEXT, 'label on warning'],
  ['primary', 'background', UI, 'primary as link/icon on page'],
  ['primary', 'card', UI, 'primary as link/icon on card'],
  ['destructive', 'background', UI, 'destructive text/icon on page'],
  ['success', 'background', UI, 'success text/icon on page'],
  ['ring', 'background', UI, 'focus ring on page'],
  ['input', 'background', UI, 'input field border on page'],
  ['input', 'card', UI, 'input field border on card'],
]
const ADVISORY = [
  ['border', 'background', UI, 'decorative divider/card outline on page'],
  ['border', 'card', UI, 'decorative divider on card'],
]

let fail = 0
for (const [name, pal] of Object.entries(THEMES)) {
  if (!pal) { console.error(`No token block found for theme "${name}"`); fail++; continue }
  console.log(`\n=== ${name.toUpperCase()} (required) ===`)
  for (const [fg, bg, min, label] of PAIRS) {
    const r = contrast(rgbOf(pal, fg, bg), rgbOf(pal, bg, bg))
    const ok = r >= min
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)} (need ${min})  ${fg} / ${bg}  — ${label}`)
  }
  console.log(`--- ${name.toUpperCase()} (advisory, decorative) ---`)
  for (const [fg, bg, min, label] of ADVISORY) {
    const r = contrast(rgbOf(pal, fg, bg), rgbOf(pal, bg, bg))
    console.log(`info  ${r.toFixed(2).padStart(5)} (~${min})  ${fg} / ${bg}  — ${label}`)
  }
}
console.log(fail === 0 ? '\nAll required pairings meet WCAG AA ✅' : `\n${fail} FAILING ❌`)
process.exit(fail === 0 ? 0 : 1)
