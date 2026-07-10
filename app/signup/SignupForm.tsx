'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { beginDemo } from '@/app/demo/actions'
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
import { Combobox } from '@/components/ui/combobox'
import { rememberCategory, requestCategory } from '@/app/advertiser/browse/actions'

// Sentinel for "my business type isn't listed" — files a review request instead
// of locking a real category.
const OTHER = '__other__'

// Sign-up form for both audiences. Advertiser is the default/primary funnel and
// captures a business category here; the host variant (role="host") is a
// clearly-secondary path that skips the category and routes into venue
// registration once the account exists.
export function SignupForm({
  role = 'advertiser',
  categories = [],
  demo = false,
  defaultCategoryId,
  defaultFullName,
  defaultEmail,
}: {
  role?: 'advertiser' | 'host'
  categories?: { id: string; name: string }[]
  // Demo mode: this form drives the guided sales walkthrough. Instead of a real
  // signup it provisions a throwaway account (no email confirmation, no charge)
  // and drops the visitor into the actual flow. Fields are prefilled for show.
  demo?: boolean
  defaultCategoryId?: string
  defaultFullName?: string
  defaultEmail?: string
}) {
  const isHost = role === 'host'
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? '')
  const [otherText, setOtherText] = useState('')
  const [fullName, setFullName] = useState(defaultFullName ?? '')
  const [email, setEmail] = useState(defaultEmail ?? '')
  const [password, setPassword] = useState(demo ? 'demo-account' : '')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const isOther = categoryId === OTHER
    if (!isHost) {
      if (!categoryId) {
        toast.error('Pick what you sell so we can lock in your category.')
        return
      }
      if (isOther && !otherText.trim()) {
        toast.error('Tell us what your business does so we can review it.')
        return
      }
    }

    // Demo mode: no real account, no email confirmation, no charge. Provision a
    // throwaway account server-side and go straight into the flow (the action
    // redirects on success; only an error comes back).
    if (demo) {
      setLoading(true)
      const res = await beginDemo({
        role,
        fullName,
        categoryId: !isHost && !isOther ? categoryId || null : null,
      })
      // Reached only on error — a success redirects and never returns.
      if (res?.error) {
        toast.error(res.error)
        setLoading(false)
      }
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
          ...(!isHost && categoryId && !isOther ? { category_id: categoryId } : {}),
          // Stash the proposed type in metadata too, so it survives an email-confirm
          // signup that has no session to file the request below.
          ...(!isHost && isOther ? { category_request: otherText.trim() } : {}),
        },
      },
    })
    if (error) {
      setLoading(false)
      toast.error(error.message)
      return
    }
    // Email confirmation is OFF, so signUp returns a session and we drop the user
    // straight into the app. If a session ever doesn't come back, sign in with the
    // same credentials right away rather than stranding them on a dead
    // "check your email" screen.
    if (!data.session) {
      const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInErr || !signIn.session) {
        setLoading(false)
        toast.error(signInErr?.message ?? 'Your account is ready — please log in to continue.')
        window.location.assign('/login')
        return
      }
    }
    // Record an advertiser's category now that we have a session: a real pick saves
    // to the profile so the buy flow never re-asks; an "Other" files a review
    // request for an admin. Hosts skip this entirely.
    if (!isHost) {
      try {
        if (isOther) await requestCategory(otherText.trim())
        else if (categoryId) await rememberCategory(categoryId)
      } catch {}
    }
    if (isHost) {
      // A fresh host has an account but no venue yet — send them straight into
      // venue registration (they now pass the host gate on that route).
      window.location.assign('/host/register')
    } else {
      // Flag a fresh sign-up so the dashboard shows the first-run walkthrough once.
      try {
        localStorage.setItem('loop.signup', '1')
        sessionStorage.setItem('loop.signup', '1')
      } catch {}
      window.location.assign('/advertiser')
    }
  }

  return (
    <Card>
      {demo && (
        <div className="mx-6 mt-6 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          Live demo — walk through exactly how a {isHost ? 'venue' : 'business'} gets set up.
          Nothing here is real and no card is ever charged.
        </div>
      )}
      <CardHeader>
        <CardTitle>{isHost ? 'Host a screen' : 'Create your advertiser account'}</CardTitle>
        <CardDescription>
          {isHost
            ? 'Run the loop on your own TV and advertise your business for free.'
            : 'Put your business on local screens.'}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <ul className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            {(isHost
              ? [
                  'Trivia, a leaderboard, and clean local ads on your screen',
                  'Free to host — we handle content and support',
                  'A code for 100% off advertising your business across the network',
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

          {/* Advertisers capture their category once, here at signup — so the buy
              flow never re-asks "what do you sell?". Used for targeting + host
              protection. Hosts pick a category per venue during registration,
              so we don't ask here. */}
          {!isHost && (
            <div className="space-y-2">
              <Label htmlFor="category">What do you sell?</Label>
              {/* Searchable picker — same one the buy flow uses — so a long
                  catalog isn't a native scroll-select on first impression. */}
              <Combobox
                options={[
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                  { value: OTHER, label: 'Other / not listed…' },
                ]}
                value={categoryId || null}
                onValueChange={(v) => setCategoryId(v ?? '')}
                placeholder="Choose your business type…"
                searchPlaceholder="Search your business type…"
              />

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
                  Tell us your line of business so we place your ads on the right screens. You only set
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
            {loading
              ? demo
                ? 'Starting…'
                : 'Creating…'
              : demo
                ? 'Start the demo'
                : isHost
                  ? 'Create host account'
                  : 'Create account'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Log in
            </Link>
          </p>
          {isHost ? (
            <p className="text-center text-xs text-muted-foreground">
              Want to advertise instead?{' '}
              <Link href="/signup" className="text-primary hover:underline">
                Create an advertiser account
              </Link>
            </p>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Have a screen to host instead?{' '}
              <Link href="/signup/host" className="text-primary hover:underline">
                Host a screen
              </Link>
            </p>
          )}
        </CardFooter>
      </form>
    </Card>
  )
}
