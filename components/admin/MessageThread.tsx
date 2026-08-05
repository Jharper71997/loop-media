'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, Mail, MessageSquare, Send, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/format'
import {
  renderTemplate,
  checkCompose,
  dashWarning,
  SMS_MAX,
  type Channel,
  type Message,
  type MessageTemplate,
  type TemplateContext,
} from '@/lib/messaging'
import { sendMessage } from '@/app/(admin)/admin/messages/actions'

// Message a prospect from their record.
//
// This is the thing the admin could not do at all. The composer previews the
// template with this record's details substituted in as you pick it, because a
// template you cannot see rendered is a template you will send with "{contact}"
// still in it.

export function MessageThread({
  opportunityId,
  advertiserId,
  email,
  phone,
  templates,
  messages,
  ready,
  smsOn,
  context,
}: {
  opportunityId?: string | null
  advertiserId?: string | null
  email: string | null
  phone: string | null
  templates: MessageTemplate[]
  messages: Message[]
  ready: boolean
  smsOn: boolean
  context: TemplateContext
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [channel, setChannel] = useState<Channel>('email')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [templateId, setTemplateId] = useState('')

  const to = channel === 'email' ? email : phone
  const usable = templates.filter((t) => t.channel === channel)
  const warning = dashWarning(body, subject)

  function applyTemplate(id: string) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (!t) return
    // Substituted immediately so what is in the box is exactly what goes out.
    setSubject(t.subject ? renderTemplate(t.subject, context) : '')
    setBody(renderTemplate(t.body, context))
  }

  function submit() {
    const check = checkCompose({ channel, to: to ?? null, subject, body })
    if (!check.ok) {
      toast.error(check.error)
      return
    }
    start(async () => {
      const res = await sendMessage({
        opportunityId,
        advertiserId,
        channel,
        to: to as string,
        subject: channel === 'email' ? subject : null,
        body,
        templateId: templateId || null,
      })
      if (res.error) {
        toast.error(res.error)
        // The row was still written, so the failure is visible in the thread.
        router.refresh()
        return
      }
      toast.success(channel === 'email' ? 'Email sent' : 'Text sent')
      setSubject('')
      setBody('')
      setTemplateId('')
      router.refresh()
    })
  }

  if (!ready) {
    return (
      <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
        <p className="text-muted-foreground">
          Messaging tables are not created yet. Run{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">loop-run-this-next.sql</code>{' '}
          from your Desktop in the Supabase SQL editor.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ---- Composer ---- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <ChannelButton
            active={channel === 'email'}
            onClick={() => setChannel('email')}
            icon={Mail}
            label="Email"
            disabled={false}
          />
          <ChannelButton
            active={channel === 'sms'}
            onClick={() => setChannel('sms')}
            icon={MessageSquare}
            label="Text"
            disabled={!smsOn}
            title={smsOn ? undefined : 'Texting needs a Twilio number. Not set up yet.'}
          />

          {usable.length > 0 && (
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="ml-auto h-7 max-w-[12rem] truncate rounded-md border border-input bg-transparent px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/40"
              aria-label="Use a template"
            >
              <option value="">Start from a template</option>
              {usable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {!to ? (
          <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            No {channel === 'email' ? 'email address' : 'phone number'} on this record. Add one in
            the contact panel and you can message them from here.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">
              To <span className="font-medium text-foreground">{to}</span>
            </p>

            {channel === 'email' && (
              <div>
                <Label className="text-[11px] text-muted-foreground">Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 h-8 text-[13px]"
                  placeholder="Quick question about your business"
                />
              </div>
            )}

            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={channel === 'sms' ? 3 : 6}
              className="text-[13px]"
              placeholder={
                channel === 'sms' ? 'Keep it short.' : 'Write it like a person, not a campaign.'
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
              }}
            />

            {warning && (
              <p className="flex items-start gap-1 text-[11px] text-warning">
                <AlertTriangle className="mt-px size-3 shrink-0" />
                {warning}
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {channel === 'sms'
                  ? `${body.length}/${SMS_MAX} characters`
                  : 'Replies come back to your inbox'}
              </span>
              <Button size="sm" onClick={submit} disabled={pending}>
                <Send className="size-3.5" />
                {pending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ---- Thread ---- */}
      <div className="border-t border-border pt-3">
        {messages.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'rounded-md border px-2.5 py-1.5',
                  m.status === 'failed'
                    ? 'border-destructive/40 bg-destructive/5'
                    : m.direction === 'in'
                      ? 'border-border bg-accent/30'
                      : 'border-border'
                )}
              >
                <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  {m.direction === 'in' ? (
                    <ArrowDownLeft className="size-3 text-success" aria-hidden />
                  ) : (
                    <ArrowUpRight className="size-3" aria-hidden />
                  )}
                  <span className="font-medium text-foreground">
                    {m.direction === 'in' ? 'Received' : m.channel === 'sms' ? 'Text' : 'Email'}
                  </span>
                  {formatDateTime(m.createdAt)}
                  {m.authorName && `· ${m.authorName}`}
                  {m.status === 'failed' && (
                    <span className="font-medium text-destructive">· did not send</span>
                  )}
                </p>
                {m.subject && <p className="mt-0.5 text-[13px] font-medium">{m.subject}</p>}
                <p className="mt-0.5 whitespace-pre-wrap text-[13px]">{m.body}</p>
                {m.error && <p className="mt-1 text-[10px] text-destructive">{m.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ChannelButton({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
  title,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Mail
  label: string
  disabled: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'bg-primary/10 font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent'
      )}
    >
      <Icon className="size-3" />
      {label}
    </button>
  )
}
