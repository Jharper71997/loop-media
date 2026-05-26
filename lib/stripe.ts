import Stripe from 'stripe'

let _stripe: Stripe | null = null

// Lazy singleton so importing this module never throws at build time when the
// key isn't set (e.g. during `next build` on a machine without secrets).
export function stripe(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  _stripe = new Stripe(key)
  return _stripe
}

// Resolve the public base URL for redirects / webhooks. Prefers the live
// request origin, then explicit env, then Vercel's injected URL, then localhost.
export function appUrl(origin?: string): string {
  if (origin) {
    try {
      return new URL(origin).origin
    } catch {
      /* fall through */
    }
  }
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
