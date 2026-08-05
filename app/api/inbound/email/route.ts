import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Inbound email — replies landing back on the record they belong to.
//
// NOT WIRED UP YET, and deliberately harmless until it is. Outbound messages set
// reply-to to the admin who sent them, so replies currently go straight to a
// human inbox and nothing is lost. This endpoint exists so that turning on
// two-way threading later is configuration rather than a build:
//
//   1. set INBOUND_EMAIL_SECRET in the environment
//   2. point an inbound route (Resend inbound, or any forwarder that POSTs JSON)
//      at  /api/inbound/email?secret=<that value>
//
// Matching is by sender address against opportunities and advertiser profiles.
// A reply from an address we do not recognise is ACCEPTED and dropped rather
// than 500'd — a webhook that errors gets retried forever and eventually
// disabled by the provider, which is a worse failure than a missed reply.

type InboundPayload = {
  // Different providers name these differently; accept the common spellings
  // rather than betting on one vendor's shape.
  from?: string | { address?: string; email?: string }
  sender?: string
  to?: string | string[]
  subject?: string
  text?: string
  html?: string
  'body-plain'?: string
  'stripped-text'?: string
}

function pickAddress(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    // "Marcus Webb <marcus@example.com>" or a bare address.
    const m = value.match(/<([^>]+)>/)
    return (m ? m[1] : value).trim().toLowerCase()
  }
  if (typeof value === 'object') {
    const o = value as { address?: string; email?: string }
    return (o.address ?? o.email ?? '').trim().toLowerCase() || null
  }
  return null
}

export async function POST(req: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET
  if (!secret) {
    // Not configured: accept and ignore, so a stray POST cannot write anything.
    return NextResponse.json({ ok: true, skipped: 'inbound not configured' })
  }

  const url = new URL(req.url)
  const provided =
    url.searchParams.get('secret') ?? req.headers.get('authorization')?.replace(/^Bearer /, '')
  if (provided !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: InboundPayload
  try {
    payload = (await req.json()) as InboundPayload
  } catch {
    return NextResponse.json({ ok: true, skipped: 'unparseable body' })
  }

  const from = pickAddress(payload.from) ?? pickAddress(payload.sender)
  const body =
    payload['stripped-text'] ?? payload.text ?? payload['body-plain'] ?? payload.html ?? ''
  if (!from || !body.trim()) {
    return NextResponse.json({ ok: true, skipped: 'no sender or no body' })
  }

  const admin = createAdminClient()

  // Most recent matching opportunity wins: the same business emailing twice
  // should thread onto the card actually being worked, not the oldest one.
  const { data: opps } = await admin
    .from('opportunities')
    .select('id, territory_id')
    .ilike('email', from)
    .order('created_at', { ascending: false })
    .limit(1)
  const opp = (opps ?? [])[0] as { id: string; territory_id: string } | undefined

  let advertiserId: string | null = null
  let territoryId: string | null = opp?.territory_id ?? null
  if (!opp) {
    const { data: profs } = await admin
      .from('profiles')
      .select('id, territory_id')
      .ilike('email', from)
      .limit(1)
    const p = (profs ?? [])[0] as { id: string; territory_id: string | null } | undefined
    if (p) {
      advertiserId = p.id
      territoryId = p.territory_id
    }
  }

  if (!opp && !advertiserId) {
    return NextResponse.json({ ok: true, skipped: `no record for ${from}` })
  }
  if (!territoryId) {
    return NextResponse.json({ ok: true, skipped: 'record has no market' })
  }

  const { error } = await admin.from('messages').insert({
    opportunity_id: opp?.id ?? null,
    advertiser_id: advertiserId,
    territory_id: territoryId,
    channel: 'email',
    direction: 'in',
    from_address: from,
    to_address: Array.isArray(payload.to) ? payload.to[0] : (payload.to ?? null),
    subject: payload.subject ?? null,
    body: body.trim().slice(0, 20_000),
    status: 'received',
    provider: 'resend',
  })
  if (error) {
    console.error('[inbound] failed to store reply:', error)
    return NextResponse.json({ ok: true, skipped: 'store failed' })
  }

  // A reply is the strongest signal a prospect gives. Stamp the touch so the
  // card stops looking cold, and put it in the timeline.
  if (opp) {
    await admin
      .from('opportunities')
      .update({ last_touch_at: new Date().toISOString() })
      .eq('id', opp.id)
    await admin.from('opportunity_events').insert({
      opportunity_id: opp.id,
      kind: 'email',
      body: `Reply from ${from}: ${body.trim().slice(0, 200)}`,
    })
  }

  return NextResponse.json({ ok: true })
}
