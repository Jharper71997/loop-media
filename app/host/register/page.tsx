import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { RegisterVenueForm } from './RegisterVenueForm'

export default async function RegisterVenuePage() {
  await requireProfile()
  const supabase = await createClient()

  const { data: cats } = await supabase.from('categories').select('id, name').order('name')
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
        <h1 className="text-2xl font-semibold tracking-tight">Register a location</h1>
        <p className="text-sm text-muted-foreground">
          Tell us about your space and we&apos;ll get a screen set up. You can register as many
          locations as you run, and each gets 2 free promo slots to advertise your own venue.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <RegisterVenueForm categories={categories} />
        </CardContent>
      </Card>
    </div>
  )
}
