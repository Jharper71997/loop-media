'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingTable } from '@/lib/opportunities'
import type { AutomationAction, AutomationTrigger } from '@/lib/automations'
import type { OpportunityKind } from '@/lib/pipeline'

const MIGRATION_HINT =
  'The automation tables do not exist yet. Run loop-run-this-next.sql (on your Desktop) in the Supabase SQL editor, then try again.'

type Result = { error: string | null }

export interface AutomationInput {
  id?: string | null
  name: string
  kind: OpportunityKind | null
  trigger: AutomationTrigger
  stage: string | null
  days: number | null
  action: AutomationAction
  actionText: string | null
  templateId: string | null
  enabled: boolean
  territoryId: string | null
}

export async function saveAutomation(input: AutomationInput): Promise<Result> {
  const profile = await requireAdmin()

  const name = input.name?.trim()
  if (!name) return { error: 'Give the rule a name.' }

  const timed = input.trigger === 'stage_stale' || input.trigger === 'no_next_step'
  if (timed && (!input.days || input.days < 1)) {
    return { error: 'How many days should it wait?' }
  }
  if (input.action === 'send_email' && !input.templateId) {
    return { error: 'Pick the template to send.' }
  }
  if (input.action !== 'send_email' && !input.actionText?.trim()) {
    return { error: 'Say what the follow-up or note should say.' }
  }
  if (input.territoryId && !adminCanTerritory(profile, input.territoryId)) {
    return { error: 'That market is outside your access.' }
  }

  const admin = createAdminClient()
  const row = {
    name,
    kind: input.kind,
    trigger: input.trigger,
    // A stage only means something for the stale trigger; carrying one on the
    // others would show a misleading sentence on the list.
    stage: input.trigger === 'stage_stale' ? input.stage : null,
    days: timed ? input.days : null,
    action: input.action,
    action_text: input.action === 'send_email' ? null : input.actionText?.trim() || null,
    template_id: input.action === 'send_email' ? input.templateId : null,
    enabled: input.enabled,
    territory_id: input.territoryId,
  }

  const { error } = input.id
    ? await admin.from('automations').update(row).eq('id', input.id)
    : await admin.from('automations').insert({ ...row, created_by: profile.id })

  if (error) return { error: isMissingTable(error) ? MIGRATION_HINT : error.message }

  revalidatePath('/admin/pipeline/automations')
  return { error: null }
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<Result> {
  await requireAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('automations').update({ enabled }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/pipeline/automations')
  return { error: null }
}

export async function deleteAutomation(id: string): Promise<Result> {
  await requireAdmin()
  const admin = createAdminClient()
  // automation_runs cascades, so deleting a rule and re-creating it will fire
  // again on the same cards. Worth knowing; that is usually what you want.
  const { error } = await admin.from('automations').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/pipeline/automations')
  return { error: null }
}
