'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Panel } from '@/components/admin/hud'
import { SOURCES, KIND_LABEL, type OpportunityKind } from '@/lib/pipeline'
import { importOpportunities, type ImportRow } from '../actions'

// Paste a list, get a board.
//
// The prospect lists that matter here already exist as spreadsheets and notes —
// the declined Brew Loop sponsors, the Surf City target list. Retyping sixty
// businesses into a form is how a CRM ends up empty forever, so the first thing
// this page has to do well is accept a blob of text.

// Fields a column can be mapped to. 'skip' is first because most pasted sheets
// carry columns this app has no use for.
const FIELDS = [
  { key: 'skip', label: 'Skip this column' },
  { key: 'businessName', label: 'Business name (required)' },
  { key: 'contactName', label: 'Contact name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' },
  { key: 'website', label: 'Website' },
  { key: 'monthly', label: 'Monthly value ($)' },
] as const

type FieldKey = (typeof FIELDS)[number]['key']

// Split one delimited line, honouring quoted fields so an address with a comma
// in it does not become two columns.
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delim) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function parse(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return []
  // Tabs win when present — that is what a spreadsheet copy/paste produces, and
  // it is unambiguous in a way commas are not.
  const delim = lines[0].includes('\t') ? '\t' : ','
  return lines.map((l) => splitLine(l, delim))
}

// A first row of short, non-numeric, non-email cells is almost certainly headers.
function looksLikeHeader(row: string[]): boolean {
  if (!row.length) return false
  return row.every((c) => c.length > 0 && c.length < 40 && !/^\d+$/.test(c) && !c.includes('@'))
}

const GUESS: [RegExp, FieldKey][] = [
  [/^(business|company|name|venue|bar|advertiser)/i, 'businessName'],
  [/(contact|owner|first.?name|person)/i, 'contactName'],
  [/(phone|cell|mobile|tel)/i, 'phone'],
  [/(e.?mail)/i, 'email'],
  [/(city|town|market)/i, 'city'],
  [/(site|url|web)/i, 'website'],
  [/(value|price|monthly|mrr|amount)/i, 'monthly'],
]

function guessField(header: string): FieldKey {
  for (const [re, key] of GUESS) if (re.test(header)) return key
  return 'skip'
}

export function ImportForm({ defaultKind }: { defaultKind: OpportunityKind }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [text, setText] = useState('')
  const [kind, setKind] = useState<OpportunityKind>(defaultKind)
  const [source, setSource] = useState('')
  // null = trust the detector; true/false = the user overrode it.
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null)
  const [mapping, setMapping] = useState<FieldKey[]>([])
  const [touched, setTouched] = useState(false)

  const rows = useMemo(() => parse(text), [text])

  // A first row of short, wordy cells is almost certainly headings, so guess it
  // rather than making every paste start with a checkbox.
  const hasHeader = headerOverride ?? (rows.length > 0 ? looksLikeHeader(rows[0]) : true)

  // Memoised: `rows[0] ?? []` allocates a fresh array every render, which would
  // invalidate the mapping memo below on every keystroke.
  const headerRow = useMemo(() => rows[0] ?? [], [rows])
  const autoMapping = useMemo(() => {
    if (!headerRow.length) return []
    return headerRow.map((h, i) =>
      hasHeader ? guessField(h) : i === 0 ? 'businessName' : ('skip' as FieldKey)
    )
  }, [headerRow, hasHeader])

  const [lastShape, setLastShape] = useState('')
  const shape = `${headerRow.length}:${hasHeader}:${headerRow.join('|')}`
  if (shape !== lastShape) {
    setLastShape(shape)
    if (!touched) setMapping(autoMapping)
  }

  const effective = mapping.length === headerRow.length ? mapping : autoMapping
  const dataRows = hasHeader ? rows.slice(1) : rows
  const nameIndex = effective.indexOf('businessName')

  const parsed: ImportRow[] = useMemo(() => {
    if (nameIndex < 0) return []
    return dataRows
      .map((cells) => {
        const get = (f: FieldKey) => {
          const i = effective.indexOf(f)
          return i >= 0 ? (cells[i] ?? '').trim() : ''
        }
        const dollars = Number(get('monthly').replace(/[$,\s]/g, ''))
        return {
          businessName: (cells[nameIndex] ?? '').trim(),
          contactName: get('contactName'),
          phone: get('phone'),
          email: get('email'),
          city: get('city'),
          website: get('website'),
          monthlyCents:
            Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : undefined,
        }
      })
      .filter((r) => r.businessName)
  }, [dataRows, effective, nameIndex])

  function submit() {
    if (!parsed.length) {
      toast.error('Nothing to import — map a column to the business name.')
      return
    }
    start(async () => {
      const res = await importOpportunities(kind, source || null, parsed)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        `${res.created} added${res.skipped > 0 ? ` · ${res.skipped} already on the board` : ''}`
      )
      setText('')
      setTouched(false)
      router.push(`/admin/pipeline?kind=${kind}`)
      router.refresh()
    })
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Paste the list" note="CSV, or straight out of a spreadsheet">
        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setTouched(false)
              setHeaderOverride(null)
            }}
            rows={12}
            spellCheck={false}
            placeholder={'Business,Contact,Phone,City\nJoyas Detailing,Ana,910-555-0134,Jacksonville'}
            className="font-mono text-xs"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">Which pipeline</Label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as OpportunityKind)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="advertiser">{KIND_LABEL.advertiser}</option>
                <option value="host">{KIND_LABEL.host}</option>
              </select>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Where they came from</Label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="">Unknown</option>
                {SOURCES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => {
                setHeaderOverride(e.target.checked)
                setTouched(false)
              }}
            />
            First row is column headings
          </label>
        </div>
      </Panel>

      <Panel
        title="Check it before it lands"
        note={parsed.length ? `${parsed.length} row${parsed.length === 1 ? '' : 's'}` : undefined}
      >
        {rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Paste something on the left and the columns show up here.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              {headerRow.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] text-muted-foreground">
                    {hasHeader ? h : `Column ${i + 1}`}
                  </span>
                  <select
                    value={effective[i] ?? 'skip'}
                    onChange={(e) => {
                      setTouched(true)
                      const next = [...effective]
                      next[i] = e.target.value as FieldKey
                      setMapping(next)
                    }}
                    className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/40"
                  >
                    {FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {nameIndex < 0 ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px]">
                Point one column at the business name — nothing can be imported without it.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Business</th>
                      <th className="px-2 py-1 text-left font-medium">Contact</th>
                      <th className="px-2 py-1 text-left font-medium">Phone</th>
                      <th className="px-2 py-1 text-right font-medium">$/mo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 6).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="max-w-40 truncate px-2 py-1">{r.businessName}</td>
                        <td className="max-w-28 truncate px-2 py-1 text-muted-foreground">
                          {r.contactName || '—'}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">{r.phone || '—'}</td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                          {r.monthlyCents ? `$${(r.monthlyCents / 100).toFixed(0)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.length > 6 && (
                  <p className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
                    +{parsed.length - 6} more
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                A business already on this board is skipped, not duplicated.
              </p>
              <Button size="sm" onClick={submit} disabled={pending || !parsed.length}>
                <Upload className="size-4" />
                {pending ? 'Importing…' : `Import ${parsed.length || ''}`}
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
