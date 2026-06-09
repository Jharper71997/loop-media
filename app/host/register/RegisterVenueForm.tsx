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
  markets,
  categories,
}: {
  markets: { id: string; name: string }[]
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [territoryId, setTerritoryId] = useState(markets[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [venueType, setVenueType] = useState('')
  const [phone, setPhone] = useState('')
  const [pending, start] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error('Enter your venue name.')
    if (!territoryId) return toast.error('Pick your city.')
    start(async () => {
      const res = await requestVenue({
        name,
        address,
        territory_id: territoryId,
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
        <Label>Address</Label>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street, city, state"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>City / market</Label>
          <Select value={territoryId} onValueChange={(v) => setTerritoryId(v ?? '')}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) => markets.find((m) => m.id === v)?.name ?? 'Select city'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {markets.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
