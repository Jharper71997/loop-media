import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  verifyQuoSignature,
  normalizeQuoEvent,
  QUO_PROVIDER,
  type NormalizedEvent,
} from '@/lib/quo'

// Quo (formerly OpenPhone) posts here when a call finishes or a text settles.
//
// This is the whole "see the calls that were made and the texts that were sent"
// feature. Nothing in the admin dials anything; the phone app does that, and
// this route writes down what happened so the record does not depend on anyone
// remembering to log it after the fact.
//
// Runs with the service-role client — there is no user session behind a webhook.

export const dynamic = 'force-dynamic'
// The raw body is needed byte-for-byte to check the signature, so nothing may
// parse or re-serialise it on the way in.
export const runtime = 'nodejs'

/**
 * Who does this number belong to?
 *
 * Matched on the last ten digits against the normalised columns 0074 maintains,
 * so `(910) 555-0134` on a prospect and `+19105550134` from Quo are the same
 * business. An advertiser wins over an opportunity when both hit: a prospect who
 * became a customer usually keeps their old pipeline row, and the live account
 * is the more useful place for the conversation to land.
 */
async function matchContact(
  supabase: ReturnType<typeof createAdminClient>,
  key: string | null
): Promise<{ opportunityId: string | null; advertiserId: string | null; territoryId: string | null }> {
  const miss = { opportunityId: null, advertiserId: null, territoryId: null }
  if (!key) return miss

  const [{ data: profiles }, { data: opps }] = await Promise.all([
    supabase.from('profiles').select('id, territory_id').eq('phone_e164', key).limit(1),
    supabase
      .from('opportunities')
      .select('id, territory_id, advertiser_id')
      .eq('phone_e164', key)
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  const profile = profiles?.[0] as { id: string; territory_id: string | null } | undefined
  const opp = opps?.[0] as
    | { id: string; territory_id: string; advertiser_id: string | null }
    | undefined

  if (profile) {
    return {
      opportunityId: opp?.id ?? null,
      advertiserId: profile.id,
      territoryId: profile.territory_id ?? opp?.territory_id ?? null,
    }
  }
  if (opp) {
    return {
      opportunityId: opp.id,
      advertiserId: opp.advertiser_id,
      territoryId: opp.territory_id,
    }
  }
  return miss
}

/**
 * `messages.territory_id` is NOT NULL, but a call from a stranger belongs to no
 * territory. Rather than drop the row — that call is a lead, see 0074 — fall
 * back to the only territory when there is only one, which is the situation this
 * business is actually in today.
 */
async function fallbackTerritory(
  supabase: ReturnType<typeof createAdminClient>
): Promise<string | null> {
  const { data } = await supabase.from('territories').select('id').limit(2)
  const rows = (data ?? []) as { id: string }[]
  return rows.length === 1 ? rows[0].id : null
}

export async function POST(req: Request) {
  const secret = process.env.QUO_WEBHOOK_SECRET
  if (!secret) {
    // 503, not 400: this is our configuration missing, and Quo should retry
    // rather than treat the delivery as permanently rejected.
    return NextResponse.json({ error: 'QUO_WEBHOOK_SECRET is not set' }, { status: 503 })
  }

  const rawBody = await req.text()
  const verified = verifyQuoSignature(req.headers, rawBody, secret)
  if (!verified.ok) {
    console.warn('[quo] rejected webhook:', verified.reason)
    return NextResponse.json({ error: verified.reason }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  let event: NormalizedEvent | null
  try {
    event = normalizeQuoEvent(payload)
  } catch (err) {
    // A parse failure must not become a retry storm — the payload is on record
    // in their dashboard and the shape is the thing to fix, not the delivery.
    console.error('[quo] could not normalise event:', err)
    return NextResponse.json({ ok: true, ignored: 'unparseable' })
  }

  // An event type we deliberately do not record (call.ringing and friends).
  if (!event) return NextResponse.json({ ok: true, ignored: 'not a recorded event type' })

  const supabase = createAdminClient()
  const match = await matchContact(supabase, event.contactKey)
  const territoryId = match.territoryId ?? (await fallbackTerritory(supabase))

  if (!territoryId) {
    // Multiple territories and an unrecognised number: we genuinely cannot say
    // which books this belongs in. Say so loudly rather than guessing.
    console.error('[quo] no territory for event', event.providerId, event.contactPhone)
    return NextResponse.json({ ok: true, ignored: 'no territory could be resolved' })
  }

  // Upsert on (provider, provider_id) — see the partial unique index in 0074.
  // Quo redelivers on any non-2xx, and a call appearing three times on a
  // timeline is worse than one that is missing: it makes the record untrustworthy.
  const { error } = await supabase.from('messages').upsert(
    {
      opportunity_id: match.opportunityId,
      advertiser_id: match.advertiserId,
      territory_id: territoryId,
      channel: event.channel,
      direction: event.direction,
      to_address: event.direction === 'out' ? event.contactPhone : event.ourPhone,
      from_address: event.direction === 'out' ? event.ourPhone : event.contactPhone,
      subject: null,
      body: event.body,
      status: event.status,
      provider: QUO_PROVIDER,
      provider_id: event.providerId,
      duration_seconds: event.durationSeconds,
      answered: event.answered,
      contact_phone: event.contactPhone,
      raw: payload,
      created_at: event.occurredAt,
    },
    { onConflict: 'provider,provider_id' }
  )

  if (error) {
    // 500 so Quo retries — a transient database problem should not cost a call.
    console.error('[quo] insert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Reaching someone IS the follow-up. Clearing the promised next step here is
  // what makes the call list burn down on its own: ring a prospect from your
  // phone in a car park and they have left "You promised" by the time you are
  // back at a desk.
  if (event.direction === 'out' && match.opportunityId) {
    await supabase
      .from('opportunities')
      .update({ last_touch_at: event.occurredAt, next_step_at: null })
      .eq('id', match.opportunityId)
  }

  return NextResponse.json({
    ok: true,
    channel: event.channel,
    matched: !!(match.opportunityId || match.advertiserId),
  })
}

// A GET makes the endpoint checkable from a browser while wiring it up, without
// revealing anything: it says whether the secret is present, never what it is.
export async function GET() {
  return NextResponse.json({
    endpoint: 'quo-webhook',
    configured: !!process.env.QUO_WEBHOOK_SECRET,
  })
}
