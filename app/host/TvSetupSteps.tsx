'use client'

import { useState } from 'react'
import { Check, Copy, Mail } from 'lucide-react'

// Walks a host through pairing a brand-new screen: where to go on the TV, what
// code to enter, and what to tap. Shown on the host dashboard for any screen
// that has a pairing code but isn't paired yet.
export function TvSetupSteps({ code, tvUrl }: { code: string; tvUrl: string }) {
  const [copied, setCopied] = useState<'url' | 'code' | null>(null)
  const display = tvUrl.replace(/^https?:\/\//, '')

  function copy(text: string, which: 'url' | 'code') {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which)
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500)
    })
  }

  const mailto =
    'mailto:?subject=' +
    encodeURIComponent('Set up the Loop Network screen') +
    '&body=' +
    encodeURIComponent(
      [
        'Set up this screen on your TV:',
        '',
        `1. On the TV, open a web browser and go to: ${tvUrl}`,
        `2. Enter this pairing code: ${code}`,
        '3. Tap "Pair screen". It goes live within a few seconds.',
      ].join('\n')
    )

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="mb-3 text-sm font-medium">Set up this screen on your TV</p>
      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <StepDot n={1} />
          <div className="min-w-0">
            <p className="text-muted-foreground">
              On the TV you want to use, open its web browser and go to:
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 font-mono">{display}</code>
              <CopyButton label="Copy link" done={copied === 'url'} onClick={() => copy(tvUrl, 'url')} />
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <StepDot n={2} />
          <div className="min-w-0">
            <p className="text-muted-foreground">Enter this pairing code:</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 font-mono text-base tracking-widest">
                {code}
              </code>
              <CopyButton label="Copy code" done={copied === 'code'} onClick={() => copy(code, 'code')} />
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <StepDot n={3} />
          <p className="text-muted-foreground">
            Tap <span className="font-medium text-foreground">Pair screen</span>. It goes live here
            within a few seconds.
          </p>
        </li>
      </ol>
      <a
        href={mailto}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Mail className="size-3.5" /> Email these steps
      </a>
    </div>
  )
}

function StepDot({ n }: { n: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
      {n}
    </span>
  )
}

function CopyButton({ label, done, onClick }: { label: string; done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {done ? 'Copied' : label}
    </button>
  )
}
