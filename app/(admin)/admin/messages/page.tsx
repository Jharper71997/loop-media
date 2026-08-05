import { AlertTriangle, Info } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SETUP_TABS } from '@/components/admin/SectionTabs'
import { HudBody, Panel } from '@/components/admin/hud'
import { loadAllTemplates } from '@/lib/conversations'
import { smsEnabled, SMS_DISABLED_REASON } from '@/lib/messaging'
import { TemplateEditor, TemplateRow } from './TemplateEditor'

// The outreach copy, in one place.

export default async function MessagesPage() {
  await requireAdmin()
  const { ready, templates } = await loadAllTemplates()
  const smsOn = smsEnabled()

  const groups = [
    { key: 'advertiser', label: 'Advertisers' },
    { key: 'host', label: 'Hosts' },
    { key: 'any', label: 'Both boards' },
  ] as const

  return (
    <>
      <PageHeader
        title="Templates"
        description={
          ready
            ? `${templates.length} template${templates.length === 1 ? '' : 's'} for outreach`
            : 'Not set up yet'
        }
        action={ready ? <TemplateEditor /> : undefined}
      />
      <SectionTabs tabs={SETUP_TABS} />

      <HudBody>
        {!ready ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="font-medium">The messaging tables have not been created yet.</p>
              <p className="text-muted-foreground">
                Paste{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  loop-run-this-next.sql
                </code>{' '}
                (on your Desktop) into the Supabase SQL editor and reload. Four starter templates
                come with it.
              </p>
            </div>
          </div>
        ) : (
          <>
            {!smsOn && (
              <p className="flex gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-px size-4 shrink-0" />
                {SMS_DISABLED_REASON} Text templates can still be written now and will work the day
                a number exists.
              </p>
            )}

            <div className="grid gap-3 lg:grid-cols-3">
              {groups.map((g) => {
                const mine = templates.filter((t) => t.audience === g.key)
                return (
                  <Panel
                    key={g.key}
                    title={g.label}
                    note={mine.length ? `${mine.length}` : undefined}
                    bodyClassName="p-0"
                  >
                    {mine.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                        Nothing here yet.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {mine.map((t) => (
                          <TemplateRow key={t.id} template={t} />
                        ))}
                      </ul>
                    )}
                  </Panel>
                )
              })}
            </div>

            <p className="px-1 text-[11px] text-muted-foreground">
              Templates fill in {'{business}'}, {'{contact}'}, {'{first_name}'}, {'{city}'} and{' '}
              {'{my_name}'} from whichever record you send from. A missing contact name reads as
              &quot;there&quot; rather than leaving a hole in the greeting.
            </p>
          </>
        )}
      </HudBody>
    </>
  )
}
