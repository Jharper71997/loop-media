'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { HOST_TOUR, type TourStep } from './steps'
import { completeHostTour } from './actions'

// One-per-tab guard so a hard reload mid-tour (or after dismissing) doesn't
// re-trigger the auto-start. Replay from Account bypasses this — it calls start().
const SESSION_KEY = 'loop.hostTour.v1'
const CARD_W = 340

type Ctx = { start: () => void }
const HostTourContext = createContext<Ctx | null>(null)

// Safe to call anywhere under the host layout; a no-op if the provider is absent.
export function useHostTour(): Ctx {
  return useContext(HostTourContext) ?? { start: () => {} }
}

type Mode = 'anchored' | 'center'

export function HostTourProvider({
  autoStart = false,
  children,
}: {
  autoStart?: boolean
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [active, setActive] = useState(false)
  const [i, setI] = useState(0)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<Mode>('center')
  const [rect, setRect] = useState<DOMRect | null>(null)

  const start = useCallback(() => {
    setI(0)
    setReady(false)
    setRect(null)
    setMode('center')
    setActive(true)
  }, [])

  // Auto-start once per tab for a fresh host.
  useEffect(() => {
    if (!autoStart) return
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {}
    start()
  }, [autoStart, start])

  const finish = useCallback(
    (go?: string) => {
      setActive(false)
      try {
        sessionStorage.setItem(SESSION_KEY, '1')
      } catch {}
      // Persist per-account so it never re-nags on another device. Best-effort.
      void completeHostTour().catch(() => {})
      if (go) router.push(go)
    },
    [router]
  )

  const step: TourStep | null = active ? HOST_TOUR[i] : null

  // Resolve each step: navigate to its page if needed, then spotlight its anchor
  // (or fall back to a centered card when the anchor isn't on the page).
  useEffect(() => {
    if (!active || !step) return
    setReady(false)

    // Navigate first; this effect re-runs once `pathname` lands on the target.
    if (step.path && pathname !== step.path) {
      router.push(step.path)
      return
    }
    if (!step.anchor) {
      setMode('center')
      setRect(null)
      setReady(true)
      return
    }

    let raf = 0
    const startedAt = Date.now()
    const anchor = step.anchor
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' })
        raf = requestAnimationFrame(() => {
          setRect(el.getBoundingClientRect())
          setMode('anchored')
          setReady(true)
        })
        return
      }
      // Anchor never showed (e.g. no venue yet) — teach it with a centered card.
      if (Date.now() - startedAt > 1500) {
        setMode('center')
        setRect(null)
        setReady(true)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, i, step, pathname, router])

  // Keep the spotlight glued to the target as the page scrolls or resizes.
  useEffect(() => {
    if (!ready || mode !== 'anchored' || !step?.anchor) return
    const anchor = step.anchor
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [ready, mode, step])

  // Esc skips the tour.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, finish])

  const isLast = i === HOST_TOUR.length - 1

  return (
    <HostTourContext.Provider value={{ start }}>
      {children}
      {active && step && (
        <TourOverlay
          step={step}
          index={i}
          total={HOST_TOUR.length}
          ready={ready}
          mode={mode}
          rect={rect}
          onBack={i > 0 ? () => setI(i - 1) : undefined}
          onNext={isLast ? () => finish('/host') : () => setI(i + 1)}
          isLast={isLast}
          onSkip={() => finish()}
        />
      )}
    </HostTourContext.Provider>
  )
}

function TourOverlay({
  step,
  index,
  total,
  ready,
  mode,
  rect,
  onBack,
  onNext,
  isLast,
  onSkip,
}: {
  step: TourStep
  index: number
  total: number
  ready: boolean
  mode: Mode
  rect: DOMRect | null
  onBack?: () => void
  onNext: () => void
  isLast: boolean
  onSkip: () => void
}) {
  const anchored = mode === 'anchored' && !!rect

  // Position the card: near the target (below if there's room, else above), or
  // dead-centered when there's no anchor.
  let cardStyle: React.CSSProperties = {
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
  }
  if (anchored && rect && typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const half = CARD_W / 2
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 12 + half), vw - 12 - half)
    const placeBelow = rect.bottom + 232 < vh
    cardStyle = placeBelow
      ? { left: cx, top: rect.bottom + 14, transform: 'translateX(-50%)' }
      : { left: cx, top: rect.top - 14, transform: 'translate(-50%, -100%)' }
  }

  return (
    <div
      className="fixed inset-0 z-[90]"
      role="dialog"
      aria-modal="true"
      aria-label="Host walkthrough"
    >
      {/* Click blocker + dim. Anchored steps dim via the spotlight's box-shadow, so
          the blocker stays transparent; centered steps darken the whole screen. */}
      <div
        className={cn(
          'absolute inset-0',
          anchored ? 'bg-transparent' : 'bg-black/70 backdrop-blur-[1px]'
        )}
      />

      {/* Spotlight cutout around the target. */}
      {anchored && rect && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary/80 transition-all duration-200"
          style={{
            left: rect.left - 8,
            top: rect.top - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
          }}
        />
      )}

      {/* The step card. */}
      <div
        className={cn(
          'absolute w-[340px] max-w-[calc(100vw-24px)] transition-opacity duration-150',
          ready ? 'opacity-100' : 'opacity-0'
        )}
        style={cardStyle}
      >
        <div className="rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Step {index + 1} of {total}
            </span>
            <button
              onClick={onSkip}
              className="-mr-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
              Skip <X className="size-3.5" />
            </button>
          </div>

          <h2 className="mt-3 font-heading text-lg font-bold tracking-tight">{step.title}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{step.body}</p>

          <div className="mt-4 flex justify-center gap-1.5">
            {Array.from({ length: total }).map((_, idx) => (
              <span
                key={idx}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  idx === index ? 'w-5 bg-primary' : 'w-1.5 bg-muted'
                )}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            {onBack && (
              <Button variant="outline" size="sm" className="flex-1" onClick={onBack}>
                Back
              </Button>
            )}
            <Button size="sm" className="flex-1" onClick={onNext}>
              {isLast ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
