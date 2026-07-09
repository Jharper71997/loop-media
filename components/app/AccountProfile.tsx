'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Edit the name + phone the user gave at sign-up. Writes straight to the user's
// own profiles row (allowed by the profiles_update_self RLS policy — no server
// action needed). Email + password live in auth.users and stay in AccountSecurity.
export function AccountProfile({
  userId,
  fullName,
  phone,
}: {
  userId: string
  fullName: string | null
  phone: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(fullName ?? '')
  const [phoneVal, setPhoneVal] = useState(phone ?? '')
  const [loading, setLoading] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name.trim() || null, phone: phoneVal.trim() || null })
      .eq('id', userId)
    setLoading(false)
    if (error) return toast.error(error.message)
    toast.success('Details saved.')
    setOpen(false)
    router.refresh()
  }

  return (
    <Card>
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 text-left"
        >
          <span className="grid size-9 place-items-center rounded-full bg-muted text-foreground">
            <UserRound className="size-4" />
          </span>
          <span className="flex-1 text-sm font-medium">Your details</span>
          <span className="text-xs text-muted-foreground">{open ? 'Close' : 'Edit'}</span>
        </button>
        {open && (
          <form onSubmit={save} className="mt-3 space-y-3 border-t pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-name">Full name</Label>
              <Input
                id="acc-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-phone">Phone</Label>
              <Input
                id="acc-phone"
                type="tel"
                autoComplete="tel"
                value={phoneVal}
                onChange={(e) => setPhoneVal(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? 'Saving…' : 'Save details'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
