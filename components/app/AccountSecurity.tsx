'use client'

import { useState } from 'react'
import { KeyRound, AtSign } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

// Self-service email + password management for the logged-in user. Lives on the
// advertiser/host Account screen. (A password is hashed and can never be shown,
// so we let them set a new one rather than view the old.)
export function AccountSecurity({ email }: { email: string }) {
  const [open, setOpen] = useState<null | 'email' | 'password'>(null)

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <button
            type="button"
            onClick={() => setOpen(open === 'email' ? null : 'email')}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="grid size-9 place-items-center rounded-full bg-muted text-foreground">
              <AtSign className="size-4" />
            </span>
            <span className="flex-1 text-sm font-medium">Change email</span>
            <span className="text-xs text-muted-foreground">{open === 'email' ? 'Close' : 'Edit'}</span>
          </button>
          {open === 'email' && <ChangeEmail current={email} onDone={() => setOpen(null)} />}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <button
            type="button"
            onClick={() => setOpen(open === 'password' ? null : 'password')}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="grid size-9 place-items-center rounded-full bg-muted text-foreground">
              <KeyRound className="size-4" />
            </span>
            <span className="flex-1 text-sm font-medium">Change password</span>
            <span className="text-xs text-muted-foreground">
              {open === 'password' ? 'Close' : 'Edit'}
            </span>
          </button>
          {open === 'password' && <ChangePassword onDone={() => setOpen(null)} />}
        </CardContent>
      </Card>
    </div>
  )
}

function ChangeEmail({ current, onDone }: { current: string; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || email.trim() === current) return toast.error('Enter a new email.')
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ email: email.trim() })
    setLoading(false)
    if (error) return toast.error(error.message)
    toast.success('Check your new email to confirm the change.')
    onDone()
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-3 border-t pt-3">
      <div className="space-y-1.5">
        <Label htmlFor="new-email">New email</Label>
        <Input
          id="new-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          We send a confirmation link to the new address before it takes effect.
        </p>
      </div>
      <Button type="submit" size="sm" disabled={loading}>
        {loading ? 'Saving…' : 'Update email'}
      </Button>
    </form>
  )
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) return toast.error('Use at least 6 characters.')
    if (password !== confirm) return toast.error('Passwords do not match.')
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return toast.error(error.message)
    toast.success('Password updated.')
    setPassword('')
    setConfirm('')
    onDone()
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-3 border-t pt-3">
      <div className="space-y-1.5">
        <Label htmlFor="acc-password">New password</Label>
        <PasswordInput
          id="acc-password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="acc-confirm">Confirm new password</Label>
        <PasswordInput
          id="acc-confirm"
          autoComplete="new-password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={loading}>
        {loading ? 'Saving…' : 'Update password'}
      </Button>
    </form>
  )
}
