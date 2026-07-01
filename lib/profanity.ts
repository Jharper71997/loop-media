// Name filter for the PUBLIC trivia join. Rejects names with profanity or slurs
// so nothing offensive ever reaches the on-screen leaderboard. Not exhaustive by
// design — it catches the obvious cases; a rejected player just picks another
// name. Kept deliberately conservative to avoid blocking real names.

// Map common leetspeak so "sh1t" / "f@ck" normalize to the real word.
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
}

// Lowercase, de-leet, strip anything non-alphabetic, then collapse 3+ repeated
// letters to one (so "fuuuuck" -> "fuck") while leaving normal doubles alone.
function normalize(s: string): string {
  const mapped = s
    .toLowerCase()
    .split('')
    .map((ch) => LEET[ch] ?? ch)
    .join('')
    .replace(/[^a-z]/g, '')
  return mapped.replace(/(.)\1{2,}/g, '$1')
}

// Clearly offensive — safe to match anywhere in the name (very low false-positive
// risk on real names).
const BLOCKED_SUBSTR = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'pussy',
  'cunt',
  'whore',
  'slut',
  'jizz',
  'dildo',
  'blowjob',
  'handjob',
  'cocksuck',
  'motherfuck',
  'dumbfuck',
  'jackoff',
  'pornhub',
  'masturbat',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'spic',
  'chink',
  'kike',
  'coon',
  'dyke',
  'tranny',
  'wetback',
  'gook',
  'beaner',
  'nazi',
  'hitler',
  'rapist',
  'kkk',
  'molest',
  'pedophile',
  'pedo',
]

// Short / ambiguous words that appear inside innocent names (Essex, Dickson,
// Hancock, Bass) — only block when they ARE essentially the whole name.
const BLOCKED_EXACT = [
  'sex',
  'cum',
  'cock',
  'dick',
  'fag',
  'ass',
  'tit',
  'tits',
  'hoe',
  'twat',
  'wank',
  'porn',
  'penis',
  'vagina',
  'boner',
  'horny',
]

// Returns false if the name should be rejected (contains profanity/a slur).
export function isNameAllowed(name: string): boolean {
  const n = normalize(name)
  if (!n) return true // emoji / numbers only — nothing to flag
  if (BLOCKED_SUBSTR.some((w) => n.includes(w))) return false
  if (BLOCKED_EXACT.includes(n)) return false
  return true
}
