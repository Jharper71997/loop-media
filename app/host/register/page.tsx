import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { RegisterVenueForm } from './RegisterVenueForm'

export default async function RegisterVenuePage() {
  await requireProfile()
  const supabase = await createClient()

  const [{ data: terr }, { data: cats }] = await Promise.all([
    supabase.from('territories').select('id, name').eq('is_holding', false).eq('status', 'active').order('name'),
    supabase.from('categories').select('id, name').order('name'),
  ])
  const markets = (terr ?? []) as { id: string; name: string }[]
  const categories = (cats ?? []) as { id: string; name: string }[]

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/host"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to dashboard
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Register your venue</h1>
        <p className="text-sm text-muted-foreground">
          Tell us about your space and we&apos;ll get a screen set up. You get 3 free promo slots
          to advertise your own venue, too.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <RegisterVenueForm markets={markets} categories={categories} />
        </CardContent>
      </Card>
    </div>
  )
}
