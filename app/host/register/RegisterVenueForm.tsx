'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { requestVenue } from './actions'

const NO_CATEGORY = 'none'

export function RegisterVenueForm({
  categories,
}: {
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [stateVal, setStateVal] = useState('')
  const [zip, setZip] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [venueType, setVenueType] = useState('')
  const [phone, setPhone] = useState('')
  const [pending, start] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error('Enter your venue name.')
    if (!city.trim() || !stateVal.trim()) return toast.error('Enter your city and state.')
    start(async () => {
      const res = await requestVenue({
        name,
        address,
        city,
        state: stateVal,
        postal_code: zip,
        category_id: categoryId,
        venue_type: venueType || null,
        foot_traffic_estimate: 0,
        contact_phone: phone || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Venue submitted — Loop Network will review and set it live.')
      router.push('/host')
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label>Venue name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="space-y-1.5">
        <Label>Street address</Label>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="614 Ensign Pl"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-1.5">
          <Label>City</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Hebron" />
        </div>
        <div className="space-y-1.5">
          <Label>State</Label>
          <Input
            value={stateVal}
            onChange={(e) => setStateVal(e.target.value.toUpperCase())}
            placeholder="IN"
            maxLength={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label>ZIP</Label>
          <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="46341" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Venue category</Label>
          <Select
            value={categoryId ?? NO_CATEGORY}
            onValueChange={(v) => setCategoryId(v === NO_CATEGORY ? null : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  v && v !== NO_CATEGORY
                    ? categories.find((c) => c.id === v)?.name ?? '—'
                    : 'Select type'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CATEGORY}>Other / not sure</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Venue type (label)</Label>
          <Input
            value={venueType}
            onChange={(e) => setVenueType(e.target.value)}
            placeholder="e.g. Coffee shop, Gym"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Contact phone (optional)</Label>
        <Input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="So we can reach you about setup"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        We&apos;ll verify your details and ship a paired screen. You&apos;ll see it on your
        dashboard once it&apos;s live.
      </p>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit venue'}
      </Button>
    </form>
  )
}
