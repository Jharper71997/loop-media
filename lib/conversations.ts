// Server-side reads for messaging.
//
// Like lib/opportunities.ts, everything here tolerates the tables not existing —
// migration 0069 is applied by hand, and until it is, the record pages must keep
// rendering rather than throwing.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/lib/opportunities'
import type { Message, MessageTemplate, Channel, Direction, MessageStatus } from '@/lib/messaging'

type MsgRow = {
  id: string
  channel: string
  direction: string
  to_address: string | null
  from_address: string | null
  subject: string | null
  body: string
  status: string
  error: string | null
  created_at: string
  author: { full_name: string | null; email: string | null }
    | { full_name: string | null; email: string | null }[]
    | null
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

function toMessage(r: MsgRow): Message {
  const a = one(r.author)
  return {
    id: r.id,
    channel: (r.channel === 'sms' ? 'sms' : 'email') as Channel,
    direction: (r.direction === 'in' ? 'in' : 'out') as Direction,
    toAddress: r.to_address,
    fromAddress: r.from_address,
    subject: r.subject,
    body: r.body,
    status: r.status as MessageStatus,
    error: r.error,
    createdAt: r.created_at,
    authorName: a?.full_name ?? a?.email ?? null,
  }
}

const SELECT =
  'id, channel, direction, to_address, from_address, subject, body, status, error, created_at, author:profiles!created_by(full_name, email)'

// The thread for one record. `advertiserId` is passed as well as
// `opportunityId` once a deal converts, so the history from before they were a
// customer stays attached to them afterwards rather than starting over.
export async function loadThread(input: {
  opportunityId?: string | null
  advertiserId?: string | null
}): Promise<{ ready: boolean; messages: Message[] }> {
  const { opportunityId, advertiserId } = input
  if (!opportunityId && !advertiserId) return { ready: true, messages: [] }

  const supabase = await createClient()
  const filters: string[] = []
  if (opportunityId) filters.push(`opportunity_id.eq.${opportunityId}`)
  if (advertiserId) filters.push(`advertiser_id.eq.${advertiserId}`)

  const { data, error } = await supabase
    .from('messages')
    .select(SELECT)
    .or(filters.join(','))
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    if (!isMissingTable(error)) console.error('[messages] loadThread failed:', error)
    return { ready: false, messages: [] }
  }
  return { ready: true, messages: ((data ?? []) as unknown as MsgRow[]).map(toMessage) }
}

export const loadTemplates = cache(async (): Promise<MessageTemplate[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, name, channel, audience, subject, body, active')
    .eq('active', true)
    .order('audience')
    .order('name')

  if (error) {
    if (!isMissingTable(error)) console.error('[messages] loadTemplates failed:', error)
    return []
  }
  return (data ?? []) as MessageTemplate[]
})

// Every template including the switched-off ones, for the management page.
export const loadAllTemplates = cache(
  async (): Promise<{ ready: boolean; templates: MessageTemplate[] }> => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('message_templates')
      .select('id, name, channel, audience, subject, body, active')
      .order('audience')
      .order('name')
    if (error) {
      if (!isMissingTable(error)) console.error('[messages] loadAllTemplates failed:', error)
      return { ready: false, templates: [] }
    }
    return { ready: true, templates: (data ?? []) as MessageTemplate[] }
  }
)

// How many messages have gone out lately, for the pipeline header. Cheap count,
// no rows returned.
export const loadOutreachCount = cache(
  async (territoryId: string | null, days: number): Promise<number> => {
    const supabase = await createClient()
    let q = supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'out')
      .gte('created_at', new Date(Date.now() - days * 86_400_000).toISOString())
    if (territoryId) q = q.eq('territory_id', territoryId)
    const { count, error } = await q
    if (error) return 0
    return count ?? 0
  }
)
