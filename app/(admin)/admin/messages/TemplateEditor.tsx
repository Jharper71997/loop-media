'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import {
  TEMPLATE_VARS,
  renderTemplate,
  dashWarning,
  usedVars,
  type Channel,
  type MessageTemplate,
} from '@/lib/messaging'
import { saveTemplate, deleteTemplate } from './actions'

// Templates are sales copy, so they are edited here rather than in code — they
// change between calls, not between deploys. The preview uses a fake prospect so
// you can see what actually lands in someone's inbox before you save it.

const PREVIEW = {
  business: "Dragon's Breath",
  contact: 'Marcus Webb',
  city: 'Jacksonville',
  myName: 'Jacob',
}

export function TemplateEditor({
  template,
  trigger,
}: {
  template?: MessageTemplate
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const [name, setName] = useState(template?.name ?? '')
  const [channel, setChannel] = useState<Channel>(template?.channel ?? 'email')
  const [audience, setAudience] = useState<'advertiser' | 'host' | 'any'>(
    template?.audience ?? 'any'
  )
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  const [active, setActive] = useState(template?.active ?? true)

  const warning = dashWarning(body, subject)
  const vars = usedVars(`${subject} ${body}`)

  function submit() {
    start(async () => {
      const res = await saveTemplate({
        id: template?.id ?? null,
        name,
        channel,
        audience,
        subject: channel === 'email' ? subject : null,
        body,
        active,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(template ? 'Template saved' : 'Template added')
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
              <Plus className="size-4" /> New template
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit template' : 'New template'}</DialogTitle>
          <DialogDescription>
            Use {'{business}'}, {'{contact}'}, {'{first_name}'}, {'{city}'} and {'{my_name}'} — they
            get filled in from the record you send from.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Label className="text-[11px] text-muted-foreground">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder="Advertiser: first touch"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Channel</Label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="email">Email</option>
              <option value="sms">Text</option>
            </select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Offer it on</Label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as 'advertiser' | 'host' | 'any')}
              className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="any">Both boards</option>
              <option value="advertiser">Advertisers only</option>
              <option value="host">Hosts only</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Available in the composer
            </label>
          </div>

          {channel === 'email' && (
            <div className="sm:col-span-3">
              <Label className="text-[11px] text-muted-foreground">Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1"
                placeholder="Quick question about {business}"
              />
            </div>
          )}

          <div className="sm:col-span-3">
            <Label className="text-[11px] text-muted-foreground">Body</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="mt-1 text-[13px]"
            />
          </div>
        </div>

        {warning && <p className="text-[11px] text-warning">{warning}</p>}

        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Preview, as {PREVIEW.contact} at {PREVIEW.business} would get it
          </p>
          {channel === 'email' && subject && (
            <p className="text-[13px] font-medium">{renderTemplate(subject, PREVIEW)}</p>
          )}
          <p className="mt-0.5 whitespace-pre-wrap text-[13px]">
            {body ? renderTemplate(body, PREVIEW) : 'Nothing yet.'}
          </p>
        </div>

        {vars.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            Fills in: {vars.map((v) => `{${v}}`).join(' ')}
            {vars.some((v) => !TEMPLATE_VARS.some((t) => t.key === v)) && (
              <span className="text-warning">
                {' '}
                — one of these is not a real variable and will send as literal text.
              </span>
            )}
          </p>
        )}

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

export function TemplateRow({ template }: { template: MessageTemplate }) {
  const router = useRouter()
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium">{template.name}</span>
          <Badge variant="secondary">{template.channel === 'sms' ? 'Text' : 'Email'}</Badge>
          {template.audience !== 'any' && (
            <Badge variant="outline">
              {template.audience === 'host' ? 'Hosts' : 'Advertisers'}
            </Badge>
          )}
          {!template.active && <Badge variant="warning">Off</Badge>}
        </div>
        {template.subject && (
          <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
            {template.subject}
          </p>
        )}
        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{template.body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <TemplateEditor
          template={template}
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
          message="Delete this template?"
          description={`"${template.name}" will be gone. Messages already sent are unaffected.`}
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={async () => {
            const res = await deleteTemplate(template.id)
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
