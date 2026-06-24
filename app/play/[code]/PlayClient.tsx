'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const GOLD = '#d4af37'

type TriviaState = {
  round: number
  phase: 'question' | 'results'
  endsInMs: number
  question: { prompt: string; choices: string[] }
  correctIdx: number | null
  leaderboard: { name: string; score: number }[]
  you: { answered: boolean; choiceIdx: number | null; score: number } | null
}

type Join = { player_id: string; venue_id: string; venue_name: string }

export function PlayClient({ code }: { code: string }) {
  const storeKey = `lm_trivia_${code}`
  const [join, setJoin] = useState<Join | null>(null)
  const [ready, setReady] = useState(false)
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [state, setState] = useState<TriviaState | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const roundRef = useRef<number | null>(null)

  // Restore a prior join for this game code.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey)
      if (raw) setJoin(JSON.parse(raw))
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
          setSelected(null) // new question → clear local pick
        }
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

  const answer = useCallback(
    async (idx: number) => {
      if (!join || !state || state.phase !== 'question') return
      if (selected != null || state.you?.answered) return
      setSelected(idx)
      try {
        await fetch('/api/trivia/answer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            player_id: join.player_id,
            venue_id: join.venue_id,
            choice_idx: idx,
          }),
        })
      } catch {
        /* the next poll reflects the truth */
      }
    },
    [join, state, selected]
  )

  if (!ready) {
    return (
      <Shell>
        <p className="text-white/50">Loading…</p>
      </Shell>
    )
  }

  if (!join) {
    return (
      <Shell>
        <h1 className="text-4xl font-extrabold tracking-tight" style={{ color: GOLD }}>
          Loop Trivia
        </h1>
        <p className="mt-2 text-white/60">
          Game <span className="font-mono tracking-widest">{code}</span>
        </p>
        <form onSubmit={joinGame} className="mt-10 w-full max-w-xs space-y-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={16}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center text-xl outline-none focus:border-[#d4af37]"
          />
          <button
            type="submit"
            disabled={joining || !name.trim()}
            style={{ background: GOLD }}
            className="w-full rounded-xl px-6 py-3 text-lg font-semibold text-black disabled:opacity-50"
          >
            {joining ? 'Joining…' : 'Play'}
          </button>
          {error && <p className="text-center text-red-400">{error}</p>}
        </form>
      </Shell>
    )
  }

  const answered = selected != null || !!state?.you?.answered
  const myChoice = selected ?? state?.you?.choiceIdx ?? null
  const secs = state ? Math.max(0, Math.round(state.endsInMs / 1000)) : 0

  return (
    <Shell>
      <div className="flex w-full max-w-md items-center justify-between text-sm">
        <span className="text-white/60">{join.venue_name}</span>
        <span className="font-mono" style={{ color: GOLD }}>
          {(state?.you?.score ?? 0) > 0 ? `🔥 ${state?.you?.score} in a row` : '0 in a row'}
        </span>
      </div>

      {state ? (
        <div className="mt-6 w-full max-w-md">
          <div className="min-h-[3.5rem] text-center text-2xl font-semibold leading-snug">
            {state.question.prompt}
          </div>
          <div className="mt-6 grid gap-3">
            {state.question.choices.map((c, i) => {
              const isCorrect = state.correctIdx === i
              const isMine = myChoice === i
              const reveal = state.phase === 'results'
              let cls = 'border-white/15 bg-white/5'
              if (reveal && isCorrect) cls = 'border-green-500 bg-green-500/20'
              else if (reveal && isMine && !isCorrect) cls = 'border-red-500 bg-red-500/20'
              else if (isMine) cls = 'border-[#d4af37] bg-[#d4af37]/15'
              return (
                <button
                  key={i}
                  disabled={answered || state.phase !== 'question'}
                  onClick={() => answer(i)}
                  className={`rounded-xl border px-4 py-4 text-left text-lg transition ${cls} disabled:cursor-default`}
                >
                  {c}
                </button>
              )
            })}
          </div>
          <p className="mt-4 text-center text-sm text-white/40">
            {state.phase === 'question'
              ? answered
                ? `Locked in — results in ${secs}s`
                : `Tap your answer · ${secs}s`
              : `Next question in ${secs}s`}
          </p>

          {state.leaderboard.length > 0 && (
            <div className="mt-8">
              <p className="mb-2 text-xs uppercase tracking-widest text-white/40">This Week</p>
              <ol className="space-y-1">
                {state.leaderboard.map((p, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span>
                      {i + 1}. {p.name}
                    </span>
                    <span className="font-mono text-white/60">{p.score}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-8 text-white/50">Starting…</p>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-start bg-black px-5 py-10 text-white">
      {children}
    </main>
  )
}
