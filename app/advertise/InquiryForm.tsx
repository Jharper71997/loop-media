'use client'

import { useState, useTransition } from 'react'
import { Check, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { submitInquiry } from './actions'

// The public enquiry form.
//
// One screen, six fields, no account. Anything longer than this and a bar owner
// standing behind their counter closes the tab.

export function InquiryForm({ defaultKind = 'advertiser' }: { defaultKind?: 'advertiser' | 'host' }) {
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [kind, setKind] = useState<'advertiser' | 'host'>(defaultKind)
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('') // honeypot

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Check className="mx-auto size-8 text-primary" />
        <p className="mt-3 text-lg font-medium">Got it.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We will get back to you shortly. If it is urgent, call the number in the footer.
        </p>
      </div>
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      const res = await submitInquiry({
        businessName,
        contactName,
        email,
        phone,
        city,
        message,
        kind,
        website,
      })
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.')
        return
      }
      setDone(true)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <Label className="text-xs text-muted-foreground">I want to</Label>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <KindButton active={kind === 'advertiser'} onClick={() => setKind('advertiser')}>
            Advertise on your screens
          </KindButton>
          <KindButton active={kind === 'host'} onClick={() => setKind('host')}>
            Put a screen in my venue
          </KindButton>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="business" className="text-xs text-muted-foreground">
            Business name
          </Label>
          <Input
            id="business"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="contact" className="text-xs text-muted-foreground">
            Your name
          </Label>
          <Input
            id="contact"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="city" className="text-xs text-muted-foreground">
            City
          </Label>
          <Input
            id="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="mt-1"
            placeholder="Jacksonville"
          />
        </div>
        <div>
          <Label htmlFor="email" className="text-xs text-muted-foreground">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="phone" className="text-xs text-muted-foreground">
            Phone
          </Label>
          <Input
            id="phone"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="message" className="text-xs text-muted-foreground">
            Anything you want us to know
          </Label>
          <Textarea
            id="message"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      {/* Honeypot: off screen, not hidden with display:none, so bots that skip
          display:none fields still fill it. Never focusable by a real person. */}
      <div className="absolute left-[-9999px] top-0" aria-hidden>
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          An email or a phone number, whichever you prefer.
        </p>
        <Button type="submit" disabled={pending}>
          <Send className="size-4" />
          {pending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  )
}

function KindButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'border-primary bg-primary/10 font-medium text-foreground'
          : 'border-border text-muted-foreground hover:border-foreground/30'
      )}
    >
      {children}
    </button>
  )
}
