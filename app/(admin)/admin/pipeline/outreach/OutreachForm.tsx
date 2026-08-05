'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, MailWarning, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Panel } from '@/components/admin/hud'
import { cn } from '@/lib/utils'
import { renderTemplate, dashWarning, BULK_MAX, type MessageTemplate } from '@/lib/messaging'
import { sendBulkOutreach } from '@/app/(admin)/admin/messages/actions'

export interface Recipient {
  id: string
  businessName: string
  contactName: string | null
  email: string | null
  city: string | null
  stageLabel: string
}

// Message a segment at once.
//
// Two rules shape this screen. Everyone starts UNSELECTED except those with an
// email — a bulk send is not something to fire by accident. And the preview
// renders against a real recipient from the list, not a made-up one, so what you
// approve is literally what the first person receives.

export function OutreachForm({
  recipients,
  templates,
}: {
  recipients: Recipient[]
  templates: MessageTemplate[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const reachable = recipients.filter((r) => r.email)
  const unreachable = recipients.filter((r) => !r.email)

  const [selected, setSelected] = useState<Set<string>>(new Set(reachable.map((r) => r.id)))
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [templateId, setTemplateId] = useState('')

  const chosen = reachable.filter((r) => selected.has(r.id))
  const warning = dashWarning(body, subject)
  const overCap = chosen.length > BULK_MAX

  // Preview against the first person who will actually get it.
  const sample = chosen[0]
  const ctx = sample
    ? { business: sample.businessName, contact: sample.contactName, city: sample.city }
    : { business: 'their business', contact: null, city: null }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function applyTemplate(id: string) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (!t) return
    // Raw template text is kept here, not the rendered version — each recipient
    // gets their own substitution at send time.
    setSubject(t.subject ?? '')
    setBody(t.body)
  }

  function submit() {
    if (!chosen.length) {
      toast.error('Nobody selected.')
      return
    }
    if (overCap) {
      toast.error(`That is more than ${BULK_MAX} at once.`)
      return
    }
    start(async () => {
      const res = await sendBulkOutreach({
        opportunityIds: chosen.map((r) => r.id),
        subject,
        body,
        templateId: templateId || null,
      })
      if (res.error && res.sent === 0) {
        toast.error(res.error)
        return
      }
      const bits = [`${res.sent} sent`]
      if (res.failed) bits.push(`${res.failed} failed`)
      if (res.skipped) bits.push(`${res.skipped} skipped`)
      toast.success(bits.join(' · '))
      setSubject('')
      setBody('')
      setTemplateId('')
      router.refresh()
    })
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel
        title="Who gets it"
        note={`${chosen.length} of ${reachable.length} selected`}
        bodyClassName="p-0"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set(reachable.map((r) => r.id)))}
          >
            All
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            None
          </Button>
          {overCap && (
            <span className="ml-auto text-[11px] text-destructive">
              Max {BULK_MAX} per send
            </span>
          )}
        </div>

        {reachable.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            Nobody in this filter has an email address.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {reachable.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-accent/40">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {r.businessName}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[r.contactName, r.email, r.city].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{r.stageLabel}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {unreachable.length > 0 && (
          <p className="flex items-start gap-1.5 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <MailWarning className="mt-px size-3 shrink-0" />
            {unreachable.length} in this filter have no email address and cannot be included:{' '}
            {unreachable
              .slice(0, 5)
              .map((r) => r.businessName)
              .join(', ')}
            {unreachable.length > 5 && `, +${unreachable.length - 5} more`}
          </p>
        )}
      </Panel>

      <Panel title="What they get">
        <div className="space-y-2">
          {templates.length > 0 && (
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring/40"
              aria-label="Use a template"
            >
              <option value="">Start from a template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          <div>
            <Label className="text-[11px] text-muted-foreground">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 h-8 text-[13px]"
              placeholder="Quick question about {business}"
            />
          </div>

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            className="text-[13px]"
            placeholder="Write it once. Each person gets their own name and city filled in."
          />

          {warning && (
            <p className="flex items-start gap-1 text-[11px] text-warning">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              {warning}
            </p>
          )}

          {(subject || body) && (
            <div className="rounded-md border border-border bg-muted/30 p-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {sample
                  ? `Preview, exactly as ${sample.contactName ?? sample.businessName} will get it`
                  : 'Preview'}
              </p>
              {subject && (
                <p className="text-[13px] font-medium">{renderTemplate(subject, ctx)}</p>
              )}
              <p className="mt-0.5 whitespace-pre-wrap text-[13px]">
                {body ? renderTemplate(body, ctx) : ''}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className={cn('text-[10px]', overCap ? 'text-destructive' : 'text-muted-foreground')}>
              Sends {chosen.length} separate email{chosen.length === 1 ? '' : 's'}, each from your
              address
            </span>
            <Button size="sm" onClick={submit} disabled={pending || !chosen.length || overCap}>
              <Send className="size-3.5" />
              {pending ? 'Sending…' : `Send ${chosen.length || ''}`}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
