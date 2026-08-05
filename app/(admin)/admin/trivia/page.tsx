import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, CONTENT_TABS } from '@/components/admin/SectionTabs'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { Badge } from '@/components/ui/badge'
import { TriviaDialog } from './TriviaDialog'
import { TriviaToggle } from './TriviaToggle'
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

export default async function TriviaPage() {
  await requireAdmin()
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

  const questions = (qData ?? []) as QRow[]
  const territories = (terrData ?? []) as { id: string; name: string }[]
  const venues = (venueData ?? []) as { id: string; name: string; territory_id: string }[]
  const terrName = new Map(territories.map((t) => [t.id, t.name]))
  const venueName = new Map(venues.map((v) => [v.id, v.name]))

  return (
    <>
      <PageHeader
        title="Trivia questions"
        description="The phone-trivia bank. Global by default; scope a question to a market or a single venue. Order is shuffled fresh each day."
        action={<TriviaDialog territories={territories} venues={venues} />}
      />
      <SectionTabs tabs={CONTENT_TABS} />

      <div className="space-y-3 p-5 md:p-6">
        {questions.length === 0 && (
          <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            No trivia questions yet. Add one to start the game between ads.
          </div>
        )}

        {questions.map((q) => {
          const scope = q.venue_id
            ? venueName.get(q.venue_id) ?? 'Venue'
            : q.territory_id
              ? terrName.get(q.territory_id) ?? 'Market'
              : 'Global'
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
