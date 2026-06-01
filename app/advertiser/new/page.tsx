import { requireProfile, homeForRole } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Package } from '@/lib/db.types'
import { NewCampaignForm } from './NewCampaignForm'

export default async function NewCampaignPage() {
  const profile = await requireProfile()
  // Admins may build a campaign too (for testing); everyone else goes home.
  if (profile.role !== 'advertiser' && profile.role !== 'admin') {
    redirect(homeForRole(profile.role))
  }
  const supabase = await createClient()

  const [{ data: terr }, { data: pkgs }, { data: cats }] = await Promise.all([
    supabase
      .from('territories')
      .select('id, name')
      .eq('is_holding', false)
      .eq('status', 'active')
      .order('name'),
    supabase.from('packages').select('*').eq('active', true).is('territory_id', null),
    supabase.from('categories').select('id, name').order('name'),
  ])

  return (
    <NewCampaignForm
      userId={profile.id}
      markets={(terr ?? []) as { id: string; name: string }[]}
      packages={(pkgs ?? []) as Package[]}
      categories={(cats ?? []) as { id: string; name: string }[]}
    />
  )
}
