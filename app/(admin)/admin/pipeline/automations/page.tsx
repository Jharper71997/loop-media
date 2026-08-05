import { AlertTriangle, Clock } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { HudBody, Panel } from '@/components/admin/hud'
import { loadTemplates } from '@/lib/conversations'
import { isMissingTable } from '@/lib/opportunities'
import type { Automation } from '@/lib/automations'
import type { OpportunityKind } from '@/lib/pipeline'
import { AutomationEditor, AutomationRow } from './AutomationEditor'
import { PipelineTabs } from '../PipelineTabs'

// Rules that run without you.
//
// Checked once a day from the existing placement cron — this project is on
// Vercel Hobby, which allows three cron jobs and already uses all three.

export default async function AutomationsPage() {
  await requireAdmin()
  const supabase = await createClient()

  const [{ data, error }, templates] = await Promise.all([
    supabase.from('automations').select('*').order('created_at', { ascending: false }),
    loadTemplates(),
  ])

  const ready = !error
  if (error && !isMissingTable(error)) console.error('[automations] load failed:', error)

  type Row = {
    id: string
    territory_id: string | null
    name: string
    enabled: boolean
    kind: string | null
    trigger: string
    stage: string | null
    days: number | null
    action: string
    action_text: string | null
    template_id: string | null
    last_run_at: string | null
  }
  const automations: Automation[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    territoryId: r.territory_id,
    name: r.name,
    enabled: r.enabled,
    kind: (r.kind as OpportunityKind | null) ?? null,
    trigger: r.trigger as Automation['trigger'],
    stage: r.stage,
    days: r.days,
    action: r.action as Automation['action'],
    actionText: r.action_text,
    templateId: r.template_id,
    lastRunAt: r.last_run_at,
  }))

  const emailTemplates = templates.filter((t) => t.channel === 'email')
  const templateName = (id: string | null) =>
    id ? (templates.find((t) => t.id === id)?.name ?? 'Deleted template') : null

  const active = automations.filter((a) => a.enabled).length

  return (
    <>
      <PageHeader
        title="Automations"
        description={
          ready
            ? automations.length === 0
              ? 'Nothing running yet'
              : `${active} of ${automations.length} running`
            : 'Not set up yet'
        }
        action={ready ? <AutomationEditor templates={emailTemplates} /> : undefined}
      />
      <PipelineTabs kind="advertiser" />

      <HudBody>
        {!ready ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="font-medium">The automation tables have not been created yet.</p>
              <p className="text-muted-foreground">
                Paste{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  loop-run-this-next.sql
                </code>{' '}
                (on your Desktop) into the Supabase SQL editor and reload.
              </p>
            </div>
          </div>
        ) : (
          <>
            <Panel
              title="Rules"
              note={automations.length ? `${automations.length}` : undefined}
              bodyClassName="p-0"
            >
              {automations.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <p className="text-sm font-medium">No rules yet.</p>
                  <p className="max-w-md text-xs text-muted-foreground">
                    The two worth starting with: put a follow-up on Today when an advertiser sits
                    in Contacted for 5 days, and send the welcome email when a deal is won.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {automations.map((a) => (
                    <AutomationRow
                      key={a.id}
                      automation={a}
                      templates={emailTemplates}
                      templateName={templateName(a.templateId)}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            <p className="flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground">
              <Clock className="mt-px size-3 shrink-0" />
              Rules are checked once a day, in the same job that places ads. Each one fires at most
              once per card ever, so a stale-deal rule chases you the first morning it qualifies
              and then stays quiet.
            </p>
          </>
        )}
      </HudBody>
    </>
  )
}
