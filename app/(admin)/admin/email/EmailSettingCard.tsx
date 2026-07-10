'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { EmailCatalogEntry } from '@/lib/emailSettings'
import { saveEmailSetting } from './actions'

export function EmailSettingCard({
  entry,
  current,
}: {
  entry: EmailCatalogEntry
  current: { enabled: boolean; subject: string | null; heading: string | null; body: string | null }
}) {
  const [enabled, setEnabled] = useState(current.enabled)
  const [subject, setSubject] = useState(current.subject ?? '')
  const [heading, setHeading] = useState(current.heading ?? '')
  const [body, setBody] = useState(current.body ?? '')
  const [pending, start] = useTransition()

  const has = (f: 'subject' | 'heading' | 'body') => entry.fields.includes(f)

  function save() {
    start(async () => {
      const res = await saveEmailSetting({ key: entry.key, enabled, subject, heading, body })
      if (res?.error) toast.error(res.error)
      else toast.success(`${entry.label} saved`)
    })
  }

  function resetToDefault() {
    setSubject('')
    setHeading('')
    setBody('')
    toast.message('Cleared overrides — Save to fall back to the default wording.')
  }

  return (
    <Card className={enabled ? undefined : 'opacity-70'}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{entry.label}</h3>
            <Badge variant="secondary">{entry.audience}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{entry.description}</p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 accent-primary"
          />
          {enabled ? 'On' : 'Off'}
        </label>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${entry.key}-subject`}>Subject</Label>
          <Input
            id={`${entry.key}-subject`}
            value={subject}
            placeholder={entry.default.subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        {has('heading') && (
          <div className="space-y-1.5">
            <Label htmlFor={`${entry.key}-heading`}>Heading</Label>
            <Input
              id={`${entry.key}-heading`}
              value={heading}
              placeholder={entry.default.heading}
              onChange={(e) => setHeading(e.target.value)}
            />
          </div>
        )}

        {has('body') && (
          <div className="space-y-1.5">
            <Label htmlFor={`${entry.key}-body`}>Body</Label>
            <Textarea
              id={`${entry.key}-body`}
              value={body}
              rows={5}
              placeholder={entry.default.body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Blank line separates paragraphs. A greeting, the branded frame, the button, and the
              footer are added automatically.
            </p>
          </div>
        )}

        {entry.placeholders.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Tokens:</span>
            {entry.placeholders.map((p) => (
              <code
                key={p}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
              >
                {`{${p}}`}
              </code>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={save} disabled={pending} size="sm">
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button onClick={resetToDefault} disabled={pending} size="sm" variant="outline">
            Reset to default
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
