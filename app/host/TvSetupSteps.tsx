'use client'

// Concierge setup: Loop Network provides a Fire Stick with the app already loaded
// and installs it on the host's TV on-site. The host does nothing technical — so
// instead of teaching pairing (open /tv, enter a code) we just reassure them and
// name the one thing they might ever do: open the app if it's closed.
export function TvSetupSteps({ paired = false }: { paired?: boolean }) {
  if (paired) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Your screen is live and running the loop. If it ever goes dark, open the{' '}
        <span className="font-medium text-foreground">Loop Network</span> app from your Fire Stick
        home screen to bring it back.
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
    </div>
  )
}
