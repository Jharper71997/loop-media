'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Megaphone, Tv as TvIcon, Check } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { rememberCategory, requestCategory } from '@/app/advertiser/browse/actions'

type Role = 'advertiser' | 'host'

// Sentinel for "my business type isn't listed" — files a review request instead
// of locking a real category.
const OTHER = '__other__'

export function SignupForm({
  initialRole = 'advertiser',
  categories = [],
}: {
  initialRole?: Role
  categories?: { id: string; name: string }[]
}) {
  const [role, setRole] = useState<Role>(initialRole)
  const [categoryId, setCategoryId] = useState('')
  const [otherText, setOtherText] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const isOther = categoryId === OTHER
    if (role === 'advertiser' && !categoryId) {
      toast.error('Pick what you sell so we can lock in your category.')
      return
    }
    if (role === 'advertiser' && isOther && !otherText.trim()) {
      toast.error('Tell us what your business does so we can review it.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
          ...(role === 'advertiser' && categoryId && !isOther ? { category_id: categoryId } : {}),
          // Stash the proposed type in metadata too, so it survives an email-confirm
          // signup that has no session to file the request below.
          ...(role === 'advertiser' && isOther ? { category_request: otherText.trim() } : {}),
        },
      },
    })
    setLoading(false)
    if (error) {
      toast.error(error.message)
      return
    }
    // With a session (no email confirmation) record their choice now. A real pick
    // saves to the profile so the buy flow never asks again; an "Other" files a
    // review request for an admin to approve, and they browse everything meanwhile.
    if (data.session && role === 'advertiser') {
      try {
        if (isOther) await requestCategory(otherText.trim())
        else if (categoryId) await rememberCategory(categoryId)
      } catch {}
    }
    // Flag a fresh sign-up so the dashboard shows the first-run walkthrough once.
    try {
      localStorage.setItem('loop.signup', '1')
      sessionStorage.setItem('loop.signup', '1')
    } catch {}
    if (data.session) {
      window.location.assign(role === 'host' ? '/host' : '/advertiser')
    } else {
      toast.success('Account created — check your email to confirm, then log in.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Advertise on the network or host a screen.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {(
              [
                {
                  r: 'advertiser' as Role,
                  Icon: Megaphone,
                  title: 'I want to advertise',
                  sub: 'Put your ad on screens around town',
                },
                {
                  r: 'host' as Role,
                  Icon: TvIcon,
                  title: 'I have a screen to host',
                  sub: 'Earn perks for hosting a TV',
                },
              ]
            ).map(({ r, Icon, title, sub }) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-4 text-left transition',
                  role === r
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/40'
                )}
              >
                <span
                  className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-full',
                    role === r ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{title}</span>
                  <span className="block text-xs text-muted-foreground">{sub}</span>
                </span>
                {role === r && <Check className="size-5 shrink-0 text-primary" />}
              </button>
            ))}
          </div>

          {/* Plain "what you get" for the chosen path, so a host (or advertiser)
              clearly sees what they're signing up for. */}
          <ul className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            {(role === 'host'
              ? [
                  'Free to host — no cost to you',
                  'Free promo slots for your business on other Loop screens around town',
                  'Keeps your customers entertained with live trivia + local info',
                ]
              : [
                  'Your ad on local TVs where your customers already go',
                  'Live in minutes — you manage it yourself',
                  'A QR on every ad tracks your real results',
                ]
            ).map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>{t}</span>
              </li>
            ))}
          </ul>

          {/* Capture category once, here at signup — so the buy flow never asks
              "what do you sell?" again. Drives category exclusivity. */}
          {role === 'advertiser' && (
            <div className="space-y-2">
              <Label htmlFor="category">What do you sell?</Label>
              <select
                id="category"
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-popover px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 [&>option]:bg-popover [&>option]:text-popover-foreground"
              >
                <option value="">Choose your business type…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={OTHER}>Other / not listed…</option>
              </select>

              {categoryId === OTHER ? (
                <>
                  <Input
                    id="otherCategory"
                    placeholder="Tell us what your business does"
                    required
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">
                    We&apos;ll review your business type and add it. You can browse every screen in
                    the meantime.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  We lock in your category so competitors can&apos;t share your screens. You only set
                  this once.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              className="h-11"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              className="h-11"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              className="h-11"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-3">
          <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={loading}>
            {loading ? 'Creating…' : 'Create account'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
