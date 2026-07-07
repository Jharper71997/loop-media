import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { BackLink } from '@/components/app/BackLink'
import { RegisterVenueForm } from './RegisterVenueForm'

export default async function RegisterVenuePage() {
  await requireProfile()
  const supabase = await createClient()

  const { data: cats } = await supabase.from('categories').select('id, name').order('name')
  const categories = (cats ?? []) as { id: string; name: string }[]

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink href="/host" label="Back to dashboard" />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Register a location</h1>
        <p className="text-sm text-muted-foreground">
          Tell us about your space and we&apos;ll get you set up to run the loop on your own TV. You
          can register as many locations as you run, and each gets 2 free promo slots to advertise
          your own venue.
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
