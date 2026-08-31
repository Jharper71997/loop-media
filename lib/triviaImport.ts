// Paste a batch of trivia questions in, rather than filling in a dialog forty
// times. Opening a new market means writing a local bank from scratch — that is
// the moment the one-at-a-time form stops being usable, and it is exactly when
// someone is most likely to have the questions already sitting in a spreadsheet
// or a chat message.
//
// Pure and client-safe on purpose: the dialog parses as you type to show what
// will land, and the server action parses the same text again before writing, so
// what you were shown and what is saved cannot drift.

export type ParsedQuestion = { prompt: string; choices: string[]; correct_idx: number }
export type BadLine = { line: number; text: string; reason: string }
export type ParseResult = { questions: ParsedQuestion[]; bad: BadLine[] }

// One question per line, six fields:
//   Question | A | B | C | D | correct
// The correct field is a letter (A-D) or a number (1-4). Fields split on TAB when
// the line has one — that is what a paste out of Google Sheets or Excel looks
// like — and on a pipe otherwise. Blank lines and #-comments are ignored.
export const TRIVIA_IMPORT_EXAMPLE =
  'Which river does Jacksonville, NC sit on? | New River | Neuse River | Cape Fear River | White Oak River | A'

export function parseTriviaBatch(text: string): ParseResult {
  const questions: ParsedQuestion[] = []
  const bad: BadLine[] = []
  // Prompts already used earlier in this same paste — a duplicate would insert
  // twice and then show up twice in the game.
  const seen = new Set<string>()

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const fields = (line.includes('\t') ? line.split('\t') : line.split('|')).map((f) => f.trim())
    const fail = (reason: string) => bad.push({ line: i + 1, text: line, reason })

    if (fields.length !== 6) {
      fail(
        fields.length < 6
          ? `Needs 6 parts (question, 4 answers, correct letter) — found ${fields.length}.`
          : `Found ${fields.length} parts; a stray | inside the question or an answer splits it.`
      )
      return
    }
    const [prompt, ...rest] = fields
    const choices = rest.slice(0, 4)
    const correctRaw = rest[4].toUpperCase()

    if (!prompt) return fail('No question text.')
    if (choices.some((c) => !c)) return fail('One of the four answers is empty.')

    // A-D or 1-4, both of which people actually type.
    const letter = 'ABCD'.indexOf(correctRaw)
    const number = /^[1-4]$/.test(correctRaw) ? Number(correctRaw) - 1 : -1
    const correct_idx = letter >= 0 ? letter : number
    if (correct_idx < 0) return fail(`"${rest[4]}" is not the correct answer — use A, B, C or D.`)

    const key = normalizePrompt(prompt)
    if (seen.has(key)) return fail('Same question appears twice in this paste.')
    seen.add(key)

    questions.push({ prompt, choices, correct_idx })
  })

  return { questions, bad }
}

// Prompts are compared loosely so a re-paste with different spacing or casing is
// still recognised as the question that is already in the bank.
export function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim()
}
