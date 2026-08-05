'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ConfirmButton } from '@/components/admin/ConfirmButton'
import { ADVERTISER_STAGES, HOST_STAGES, type OpportunityKind } from '@/lib/pipeline'
import {
  TRIGGER_LABEL,
  ACTION_LABEL,
  describe,
  type Automation,
  type AutomationAction,
  type AutomationTrigger,
} from '@/lib/automations'
import type { MessageTemplate } from '@/lib/messaging'
import { saveAutomation, setAutomationEnabled, deleteAutomation } from './actions'

export function AutomationEditor({
  automation,
  templates,
  trigger,
}: {
  automation?: Automation
  templates: MessageTemplate[]
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const [name, setName] = useState(automation?.name ?? '')
  const [kind, setKind] = useState<OpportunityKind | ''>(automation?.kind ?? '')
  const [trig, setTrig] = useState<AutomationTrigger>(automation?.trigger ?? 'stage_stale')
  const [stage, setStage] = useState(automation?.stage ?? '')
  const [days, setDays] = useState(String(automation?.days ?? 7))
  const [action, setAction] = useState<AutomationAction>(automation?.action ?? 'set_next_step')
  const [actionText, setActionText] = useState(automation?.actionText ?? '')
  const [templateId, setTemplateId] = useState(automation?.templateId ?? '')

  const timed = trig === 'stage_stale' || trig === 'no_next_step'
  // Stage options depend on which board the rule watches. "Both boards" cannot
  // name a stage, since the two pipelines have entirely different ones.
  const stages = kind === 'host' ? HOST_STAGES : kind === 'advertiser' ? ADVERTISER_STAGES : []

  function submit() {
    start(async () => {
      const res = await saveAutomation({
        id: automation?.id ?? null,
        name,
        kind: kind || null,
        trigger: trig,
        stage: stage || null,
        days: timed ? Number(days) : null,
        action,
        actionText,
        templateId: templateId || null,
        enabled: automation?.enabled ?? true,
        territoryId: automation?.territoryId ?? null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(automation ? 'Rule saved' : 'Rule added')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button size="sm">
              <Plus className="size-4" /> New rule
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{automation ? 'Edit rule' : 'New rule'}</DialogTitle>
          <DialogDescription>
            Rules are checked once a day. Each one fires at most once per card, so nothing gets
            chased twice.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder="Chase anything sitting in Contacted"
            />
          </div>

          <Field label="Watches">
            <Select value={kind} onChange={(v) => { setKind(v as OpportunityKind | ''); setStage('') }}>
              <option value="">Both boards</option>
              <option value="advertiser">Advertisers</option>
              <option value="host">Hosts</option>
            </Select>
          </Field>

          <Field label="When">
            <Select value={trig} onChange={(v) => setTrig(v as AutomationTrigger)}>
              {(Object.keys(TRIGGER_LABEL) as AutomationTrigger[]).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>

          {trig === 'stage_stale' && (
            <Field
              label="In which stage"
              hint={stages.length === 0 ? 'Pick a board first to choose a stage.' : undefined}
            >
              <Select value={stage} onChange={setStage} disabled={stages.length === 0}>
                <option value="">Any stage</option>
                {stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {timed && (
            <Field label="After how many days">
              <Input
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="numeric"
                className="h-9"
              />
            </Field>
          )}

          <Field label="Then" className="sm:col-span-2">
            <Select value={action} onChange={(v) => setAction(v as AutomationAction)}>
              {(Object.keys(ACTION_LABEL) as AutomationAction[]).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </Select>
          </Field>

          {action === 'send_email' ? (
            <Field
              label="Which template"
              className="sm:col-span-2"
              hint={
                templates.length === 0
                  ? 'No email templates yet. Add one under Setup, Templates.'
                  : 'Sent from Loop Network rather than from you, since nobody typed it.'
              }
            >
              <Select value={templateId} onChange={setTemplateId} disabled={!templates.length}>
                <option value="">Choose…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field
              label={action === 'set_next_step' ? 'Follow-up text' : 'Note text'}
              className="sm:col-span-2"
            >
              <Input
                value={actionText}
                onChange={(e) => setActionText(e.target.value)}
                className="h-9"
                placeholder={
                  action === 'set_next_step' ? 'Call and ask for the owner' : 'Went quiet'
                }
              />
            </Field>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AutomationRow({
  automation,
  templates,
  templateName,
}: {
  automation: Automation
  templates: MessageTemplate[]
  templateName: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium">{automation.name}</span>
          {!automation.enabled && <Badge variant="secondary">Paused</Badge>}
          {automation.action === 'send_email' && templateName && (
            <Badge variant="outline">{templateName}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{describe(automation)}</p>
        {automation.lastRunAt && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/80">
            Last checked {new Date(automation.lastRunAt).toLocaleDateString()}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setAutomationEnabled(automation.id, !automation.enabled)
              if (res.error) toast.error(res.error)
              else router.refresh()
            })
          }
        >
          {automation.enabled ? 'Pause' : 'Resume'}
        </Button>
        <AutomationEditor
          automation={automation}
          templates={templates}
          trigger={
            <Button variant="ghost" size="icon-sm" title="Edit">
              <Pencil className="size-3.5" />
            </Button>
          }
        />
        <ConfirmButton
          variant="ghost"
          size="icon-sm"
          title="Delete"
          message="Delete this rule?"
          description="Its record of which cards it already fired on goes too, so re-creating it later will chase them again."
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={async () => {
            const res = await deleteAutomation(automation.id)
            if (res.error) toast.error(res.error)
            else {
              toast.success('Deleted')
              router.refresh()
            }
          }}
        >
          <Trash2 className="size-3.5" />
        </ConfirmButton>
      </div>
    </li>
  )
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
    >
      {children}
    </select>
  )
}
