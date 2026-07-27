'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Sparkles,
  MapPin,
  Tag,
  Upload,
  Tv as TvIcon,
  PlugZap,
  Megaphone,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// Shown once, right after sign-up (SignupForm sets the `loop.signup` flag).
// Role-aware quick tour; dismissing or finishing clears the flag so it never
// reappears for that user on this device.
export const SIGNUP_FLAG = 'loop.signup'

type Step = { icon: LucideIcon; title: string; body: string }

const STEPS: Record<'advertiser' | 'host', { steps: Step[]; cta: string; href: string }> = {
  advertiser: {
    steps: [
      {
        icon: Sparkles,
        title: 'Welcome to Loop Network',
        body: 'Your 15-second ad on the TVs in the busiest bars, gyms, and shops around town. Here\'s how it works.',
      },
      {
        icon: MapPin,
        title: 'Pick your spots',
        body: 'Open the map and tap the businesses you want a screen in. Each one shows its own monthly price.',
      },
      {
        icon: Tag,
        title: 'The more you add, the less you pay',
        body: 'Every screen is just $50 a month, and volume discounts kick in as you add more.',
      },
      {
        icon: Upload,
        title: 'Add your ad and go live',
        body: 'Upload a 15-second video or image — or have us make one — and it runs as soon as it\'s approved.',
      },
    ],
    cta: 'Build my first campaign',
    href: '/advertiser/browse',
  },
  host: {
    steps: [
      {
        icon: TvIcon,
        title: 'Welcome to Loop Network',
        body: 'Turn the TV you already own into a draw for customers — trivia, a leaderboard, and clean local ads. Here\'s the gist.',
      },
      {
        icon: PlugZap,
        title: 'Pair your screen',
        body: 'Setup takes about two minutes — scan a code, like setting up a Ring doorbell, and you\'re live.',
      },
      {
        icon: Megaphone,
        title: 'Advertise for free',
        body: 'Once your venue is live, you get a code for 100% off advertising your business across the network.',
      },
    ],
    cta: 'Set up my venue',
    href: '/host/register',
  },
}

export function OnboardingTour({ role }: { role: 'advertiser' | 'host' }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SIGNUP_FLAG) === '1' || localStorage.getItem(SIGNUP_FLAG) === '1') {
        setOpen(true)
      }
    } catch {}
  }, [])

  function finish(go?: string) {
    try {
      sessionStorage.removeItem(SIGNUP_FLAG)
      localStorage.removeItem(SIGNUP_FLAG)
    } catch {}
    setOpen(false)
    if (go) router.push(go)
  }

  if (!open) return null

  const { steps, cta, href } = STEPS[role]
  const step = steps[i]
  const Icon = step.icon
  const last = i === steps.length - 1

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* gold glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-40"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.25), transparent 70%)',
        }}
      />

      <div className="flex items-center justify-between px-4 pt-4">
        <Image
          src="/loop-network-emblem.png"
          alt="Loop Network"
          width={24}
          height={27}
          className="h-7 w-auto"
        />
        <button
          onClick={() => finish()}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Skip <X className="size-4" />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="grid size-20 place-items-center rounded-3xl bg-primary/15 text-primary">
          <Icon className="size-9" />
        </span>
        <h1 className="mt-8 font-heading text-3xl font-bold tracking-tight">{step.title}</h1>
        <p className="mt-3 text-pretty text-base text-muted-foreground">{step.body}</p>
      </div>

      <div className="mx-auto w-full max-w-md px-6 pb-8">
        <div className="mb-5 flex justify-center gap-2">
          {steps.map((_, idx) => (
            <span
              key={idx}
              className={cn(
                'h-1.5 rounded-full transition-all',
                idx === i ? 'w-6 bg-primary' : 'w-1.5 bg-muted'
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          {i > 0 && (
            <Button variant="outline" size="lg" className="h-12" onClick={() => setI(i - 1)}>
              Back
            </Button>
          )}
          {last ? (
            <Button size="lg" className="h-12 flex-1 text-base" onClick={() => finish(href)}>
              {cta}
            </Button>
          ) : (
            <Button size="lg" className="h-12 flex-1 text-base" onClick={() => setI(i + 1)}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
