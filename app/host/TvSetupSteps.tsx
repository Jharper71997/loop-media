'use client'

// Concierge setup: Loop Network provides a Fire Stick with the app already loaded
// and installs it on the host's TV on-site. The host does nothing technical — so
// instead of teaching pairing (open /tv, enter a code) we just reassure them and
// name the one thing they might ever do: open the app if it's closed.
//
// We DO surface the screen's pairing code, though. If a stick ever loses its
// pairing (a reinstall, a factory reset, someone taps Unpair) the TV drops back to
// the "Pair this screen" prompt — and that prompt tells the host the code is "on
// your dashboard, next to this screen." THIS is where it has to live. The code is
// permanent + reusable, and it's the host's own screen, so showing it is safe — a
// live screen can't be stolen with it (see app/api/tv/pair).
export function TvSetupSteps({
  paired = false,
  pairingCode,
}: {
  paired?: boolean
  pairingCode?: string | null
}) {
  const codeBlock = pairingCode ? (
    <div className="mt-3 rounded-md border border-border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">
        If the TV ever shows a “Pair this screen” prompt, open the{' '}
        <span className="font-medium text-foreground">Loop Network</span> app and enter this code:
      </p>
      <p className="mt-1 font-heading text-lg font-bold tracking-[0.25em] tabular-nums">
        {pairingCode}
      </p>
    </div>
  ) : null

  if (paired) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Your screen is live and running the loop. If it ever goes dark, open the{' '}
        <span className="font-medium text-foreground">Loop Network</span> app from your Fire Stick
        home screen to bring it back.
        {codeBlock}
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="mb-1 text-sm font-medium">We&apos;ll set up your screen for you</p>
      <p className="text-sm text-muted-foreground">
        We&apos;ll reach out to schedule a quick visit and bring a Loop Network Fire Stick with
        everything already loaded — nothing to download or plug into a computer, nothing to
        configure. Once it&apos;s running, the only thing you might ever do is open the Loop Network
        app from your Fire Stick home screen if it isn&apos;t already showing.
      </p>
      {codeBlock}
    </div>
  )
}
