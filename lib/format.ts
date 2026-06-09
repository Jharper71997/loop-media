// Small shared formatters.

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// A screen is "live" only if it checked in recently. The TV posts a heartbeat
// every 30s; allow ~3 misses before we call it offline. (The stored `status`
// enum is unreliable — nothing flips it back to offline — so trust the clock.)
export function isTvLive(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false
  return Date.now() - new Date(lastHeartbeat).getTime() < 95_000
}

// e.g. "2 minutes ago" / "3 days ago"; used for TV last-heartbeat freshness.
export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
