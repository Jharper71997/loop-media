import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SHIP_TABS } from '@/components/admin/SectionTabs'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { TriviaDialog } from './TriviaDialog'
import { TriviaToggle } from './TriviaToggle'
import { TriviaImportDialog } from './TriviaImportDialog'
import { CopyMarketDialog } from './CopyMarketDialog'
import { deleteTriviaQuestion } from './actions'

export const dynamic = 'force-dynamic'

type QRow = {
  id: string
  prompt: string
  choices: string[]
  correct_idx: number
  active: boolean
  territory_id: string | null
  venue_id: string | null
}

// The bank is filtered by market, in the URL.
//
// A screen plays the global questions PLUS its own market's, so "what does
// Jacksonville ask" and "what would a new city ask" are the two questions this
// page has to answer, and one flat list of 200+ rows answers neither. `all` stays
// the default, so nothing anyone bookmarked changed meaning.
export default async function TriviaPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>
}) {
  await requireAdmin()
  const { market = 'all' } = await searchParams
  const supabase = await createClient()

  const [{ data: qData }, { data: terrData }, { data: venueData }] = await Promise.all([
    supabase
      .from('trivia_questions')
      .select('id, prompt, choices, correct_idx, active, territory_id, venue_id')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    supabase.from('territories').select('id, name').eq('is_holding', false).order('name'),
    supabase.from('venues').select('id, name, territory_id').eq('status', 'active').order('name'),
  ])

  const all = (qData ?? []) as QRow[]
  const territories = (terrData ?? []) as { id: string; name: string }[]
  const venues = (venueData ?? []) as { id: string; name: string; territory_id: string }[]
  const terrName = new Map(territories.map((t) => [t.id, t.name]))
  const venueName = new Map(venues.map((v) => [v.id, v.name]))

  const globalCount = all.filter((q) => !q.territory_id).length
  const markets = territories.map((t) => ({
    ...t,
    localCount: all.filter((q) => q.territory_id === t.id).length,
  }))
  const selected = territories.find((t) => t.id === market) ?? null

  const questions =
    market === 'all'
      ? all
      : market === 'global'
        ? all.filter((q) => !q.territory_id)
        : all.filter((q) => q.territory_id === market)

  const chips: { key: string; label: string; count: number }[] = [
    { key: 'all', label: 'Everything', count: all.length },
    { key: 'global', label: 'Every market', count: globalCount },
    ...markets.map((m) => ({ key: m.id, label: m.name, count: m.localCount })),
  ]

  return (
    <>
      <PageHeader
        title="Trivia questions"
        description="The phone-trivia bank. A screen plays the questions every market gets, plus its own market's local ones."
        action={<TriviaDialog territories={territories} venues={venues} />}
      />
      <SectionTabs tabs={SHIP_TABS} />

      <div className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <Link
                key={c.key}
                href={c.key === 'all' ? '/admin/trivia' : `/admin/trivia?market=${c.key}`}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  market === c.key
                    ? 'border-primary bg-primary/10 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {c.label}{' '}
                <span className="font-mono tabular-nums text-[11px] text-muted-foreground">
                  {c.count}
                </span>
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <TriviaImportDialog territories={territories} defaultTerritoryId={selected?.id ?? null} />
            <CopyMarketDialog markets={markets} defaultToId={selected?.id ?? null} />
          </div>
        </div>

        {questions.length === 0 && (
          <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            {selected ? (
              <>
                <p className="font-medium text-foreground">
                  {selected.name} has no local questions yet.
                </p>
                <p className="mx-auto mt-1 max-w-md">
                  Screens there still play the {globalCount} questions every market gets. The local
                  ones are what a room actually plays for, so import a batch or copy a nearby
                  market&apos;s.
                </p>
              </>
            ) : (
              'No trivia questions yet. Add one to start the game between ads.'
            )}
          </div>
        )}

        {questions.map((q) => {
          const scope = q.venue_id
            ? venueName.get(q.venue_id) ?? 'Venue'
            : q.territory_id
              ? terrName.get(q.territory_id) ?? 'Market'
              : 'Every market'
          return (
            <div
              key={q.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{scope}</Badge>
                  {!q.active && <Badge variant="outline">Paused</Badge>}
                </div>
                <p className="mt-2 font-medium">{q.prompt}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {(q.choices ?? []).map((c, i) => (
                    <span key={i} className={i === q.correct_idx ? 'font-medium text-success' : ''}>
                      {String.fromCharCode(65 + i)}. {c}
                      {i === q.correct_idx ? ' ✓' : ''}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <TriviaDialog
                  territories={territories}
                  venues={venues}
                  existing={{
                    id: q.id,
                    prompt: q.prompt,
                    choices: q.choices ?? ['', '', '', ''],
                    correct_idx: q.correct_idx,
                    territory_id: q.territory_id,
                    venue_id: q.venue_id,
                  }}
                />
                <TriviaToggle id={q.id} active={q.active} />
                <DeleteButton id={q.id} action={deleteTriviaQuestion} />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
