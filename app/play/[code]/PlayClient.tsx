'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MAX_POINTS, pointsWithMsLeft } from '@/lib/trivia'

type TriviaState = {
  round: number
  phase: 'question' | 'results'
  endsInMs: number
  question: { prompt: string; choices: string[] }
  correctIdx: number | null
  leaderboard: { name: string; score: number }[]
  you: { answered: boolean; choiceIdx: number | null; score: number; awarded: number | null } | null
  sponsors?: {
    adId: string | null
    tvId: string | null
    name: string
    what: string | null
    url: string
  }[]
}

type Join = { player_id: string; venue_id: string; venue_name: string; token: string }

export function PlayClient({ code }: { code: string }) {
  const storeKey = `lm_trivia_${code}`
  const [join, setJoin] = useState<Join | null>(null)
  const [ready, setReady] = useState(false)
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [state, setState] = useState<TriviaState | null>(null)
  const [picked, setPicked] = useState<number | null>(null) // tapped, not yet locked in
  const [locked, setLocked] = useState(false) // locked in this round (local echo)
  const [submitting, setSubmitting] = useState(false)
  const roundRef = useRef<number | null>(null)
  // What the question is worth right now, ticking down between polls. Anchored to
  // the server's endsInMs on every poll so a phone with a wrong clock still sees
  // the real number.
  const [worth, setWorth] = useState(MAX_POINTS)
  const worthAnchor = useRef<{ endsAt: number } | null>(null)
  // What the last locked-in answer actually banked (server-authoritative).
  const [awarded, setAwarded] = useState<number | null>(null)

  // Restore a prior join for this game code.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey)
      if (raw) {
        const j = JSON.parse(raw)
        // Require a token — a pre-upgrade session without one must rejoin so the
        // answer endpoint accepts it.
        if (j && j.token) setJoin(j)
      }
    } catch {
      /* ignore */
    }
    setReady(true)
  }, [storeKey])

  const joinGame = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setJoining(true)
      setError(null)
      try {
        const res = await fetch('/api/trivia/join', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, name }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not join')
        const j: Join = {
          player_id: data.player_id,
          venue_id: data.venue_id,
          venue_name: data.venue_name,
          token: data.token,
        }
        localStorage.setItem(storeKey, JSON.stringify(j))
        setJoin(j)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not join')
      } finally {
        setJoining(false)
      }
    },
    [code, name, storeKey]
  )

  // Poll live state while joined.
  useEffect(() => {
    if (!join) return
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/trivia/state?venue=${join.venue_id}&player=${join.player_id}`,
          { cache: 'no-store' }
        )
        if (!res.ok) return
        const data: TriviaState = await res.json()
        if (!alive) return
        if (roundRef.current !== data.round) {
          roundRef.current = data.round
          setPicked(null) // new question → clear tentative pick
          setLocked(false)
          setAwarded(null)
        }
        // Re-anchor the points counter to the server's clock on every poll.
        worthAnchor.current =
          data.phase === 'question' ? { endsAt: Date.now() + Math.max(0, data.endsInMs) } : null
        if (data.you?.awarded != null) setAwarded(data.you.awarded)
        setState(data)
      } catch {
        /* keep last */
      }
    }
    tick()
    const id = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [join])

  // Tick the live points counter down between polls. Four times a second, because
  // a value that visibly slides is the whole point — a number that only moved when
  // the poll landed would read as a static label.
  useEffect(() => {
    const id = setInterval(() => {
      const a = worthAnchor.current
      setWorth(a ? pointsWithMsLeft(Math.max(0, a.endsAt - Date.now())) : MAX_POINTS)
    }, 250)
    return () => clearInterval(id)
  }, [])

  // Tapping a choice only PICKS it (highlights). Nothing is recorded until the
  // player presses "Lock it in" — that's the actual submit.
  const lockIn = useCallback(async () => {
    if (!join || !state || state.phase !== 'question') return
    if (picked == null || locked || state.you?.answered) return
    setLocked(true)
    setSubmitting(true)
    try {
      const res = await fetch('/api/trivia/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          player_id: join.player_id,
          token: join.token,
          choice_idx: picked,
          // The round on screen when they locked in, so the server never grades
          // against a question that rolled over between the poll and this submit.
          round: state.round,
        }),
      })
      // The server's award is the real number (it scores off its own clock, not
      // the counter on this phone). Show it the instant it comes back.
      const data = await res.json().catch(() => null)
      if (res.ok && data && typeof data.points === 'number') setAwarded(data.points)
    } catch {
      /* the next poll reflects the truth */
    } finally {
      setSubmitting(false)
    }
  }, [join, state, picked, locked])

  if (!ready) {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    )
  }

  if (!join) {
    return (
      <Shell>
        <Image
          src="/loop-network-emblem.png"
          alt="Loop Network"
          width={56}
          height={62}
          priority
          className="h-14 w-auto"
        />
        <h1 className="mt-5 font-heading text-4xl font-extrabold tracking-tight text-primary">
          Loop Trivia
        </h1>
        <p className="mt-2 text-muted-foreground">
          Game <span className="font-mono tracking-widest text-foreground">{code}</span>
        </p>
        <form onSubmit={joinGame} className="mt-10 w-full max-w-xs space-y-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={16}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-xl text-foreground outline-none transition focus:border-primary"
          />
          <Button
            type="submit"
            size="lg"
            disabled={joining || !name.trim()}
            className="h-14 w-full text-lg"
          >
            {joining ? 'Joining…' : 'Play'}
          </Button>
          {error && <p className="text-center text-destructive">{error}</p>}
        </form>
      </Shell>
    )
  }

  const answered = locked || !!state?.you?.answered
  const myChoice = picked ?? state?.you?.choiceIdx ?? null
  const secs = state ? Math.max(0, Math.round(state.endsInMs / 1000)) : 0

  return (
    <Shell>
      <div className="flex w-full max-w-md items-center justify-between text-sm">
        <span className="flex items-center gap-1.5">
          <Image
            src="/loop-network-emblem.png"
            alt=""
            width={20}
            height={22}
            className="h-4 w-auto"
          />
          <span className="font-heading font-bold text-primary">Loop Network</span>
        </span>
        <span className="font-mono text-primary">
          {(state?.you?.score ?? 0).toLocaleString()} pts
        </span>
      </div>

      {state ? (
        <div className="mt-6 w-full max-w-md">
          {/* Live value of the question. Draining on screen is what makes people
              answer NOW instead of waiting for the table to agree. Once they've
              locked in, it flips to what they actually banked. */}
          <div className="mb-4 flex items-baseline justify-center gap-2">
            {answered ? (
              <>
                <span
                  className={cn(
                    'font-mono text-4xl font-bold tabular-nums',
                    (awarded ?? 0) > 0 ? 'text-success' : 'text-muted-foreground'
                  )}
                >
                  {(awarded ?? 0) > 0 ? `+${(awarded ?? 0).toLocaleString()}` : '+0'}
                </span>
                <span className="text-sm text-muted-foreground">
                  {state.phase === 'results'
                    ? (awarded ?? 0) > 0
                      ? 'nice'
                      : 'no points this round'
                    : 'locked in'}
                </span>
              </>
            ) : state.phase === 'question' ? (
              <>
                <span
                  className={cn(
                    'font-mono text-4xl font-bold tabular-nums transition-colors',
                    worth <= 300 ? 'text-destructive' : worth <= 600 ? 'text-amber-400' : 'text-primary'
                  )}
                >
                  {worth.toLocaleString()}
                </span>
                <span className="text-sm text-muted-foreground">points, dropping</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Next question coming up</span>
            )}
          </div>
          <div className="min-h-[3.5rem] text-center text-2xl font-semibold leading-snug text-foreground">
            {state.question.prompt}
          </div>
          <div className="mt-6 grid gap-3">
            {state.question.choices.map((c, i) => {
              const isCorrect = state.correctIdx === i
              const isMine = myChoice === i
              const reveal = state.phase === 'results'
              let cls = 'border-border bg-card'
              if (reveal && isCorrect) cls = 'border-success bg-success/20'
              else if (reveal && isMine && !isCorrect) cls = 'border-destructive bg-destructive/20'
              else if (isMine) cls = 'border-primary bg-primary/15'
              return (
                <button
                  key={i}
                  disabled={answered || state.phase !== 'question'}
                  onClick={() => setPicked(i)}
                  className={cn(
                    'rounded-xl border px-4 py-4 text-left text-lg text-foreground transition disabled:cursor-default',
                    cls
                  )}
                >
                  {c}
                </button>
              )
            })}
          </div>

          {state.phase === 'question' && !answered && (
            <Button
              onClick={lockIn}
              size="lg"
              disabled={picked == null || submitting}
              className="mt-4 h-14 w-full text-lg"
            >
              {submitting
                ? 'Locking in…'
                : picked == null
                  ? 'Pick an answer'
                  : `Lock it in for ${worth.toLocaleString()}`}
            </Button>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {state.phase === 'question'
              ? answered
                ? `Locked in — results in ${secs}s`
                : picked == null
                  ? `Tap an answer · ${secs}s`
                  : `Press lock in · ${secs}s`
              : `Next question in ${secs}s`}
          </p>

          {state.sponsors && state.sponsors.length > 0 && (
            <div className="mt-8">
              <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                On the screens here
              </p>
              <div className="grid gap-2">
                {state.sponsors.map((s) => (
                  <a
                    key={s.adId ?? s.name}
                    href={s.adId && s.tvId ? `/r/${s.adId}?t=${s.tvId}` : s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-primary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-foreground">{s.name}</span>
                      {s.what && (
                        <span className="block truncate text-xs text-muted-foreground">{s.what}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-primary">Visit →</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {state.leaderboard.length > 0 && (
            <div className="mt-8">
              <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                This Week
              </p>
              <ol className="space-y-1">
                {state.leaderboard.map((p, i) => (
                  <li key={i} className="flex justify-between text-sm text-foreground">
                    <span>
                      {i + 1}. {p.name}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {p.score.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-8 text-muted-foreground">Starting…</p>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-start bg-gradient-to-b from-[#1c1813] via-[#0d0c0a] to-black px-5 py-10 text-foreground">
      {children}
    </main>
  )
}
