'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createTerritory } from './actions'

// The zones a US market can be in. A market's timezone decides what "today" means
// for its screens' open hours and its reports, so it is asked for up front rather
// than left on the table default.
const ZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

// City + state, not a free-text name, on purpose: a host registering a venue in a
// city we do not have yet creates the market automatically as "City, ST". Typing a
// market any other way here would leave the next host in that city creating a
// duplicate next to it.
export function NewTerritory() {
  const router = useRouter()
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zone, setZone] = useState('America/New_York')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!city.trim()) return
    start(async () => {
      const res = await createTerritory({ city, state, timezone: zone })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`${city.trim()}, ${state.trim().toUpperCase()} added.`)
      setCity('')
      setState('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        className="h-8 w-44"
        placeholder="City"
        value={city}
        onChange={(e) => setCity(e.target.value)}
      />
      <Input
        className="h-8 w-16 uppercase"
        placeholder="ST"
        maxLength={2}
        value={state}
        onChange={(e) => setState(e.target.value)}
      />
      <Select value={zone} onValueChange={(v) => setZone(v ?? 'America/New_York')}>
        <SelectTrigger className="h-8 w-40" size="sm">
          <SelectValue>
            {(v: string | null) => ZONES.find((z) => z.value === v)?.label ?? 'Timezone'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ZONES.map((z) => (
            <SelectItem key={z.value} value={z.value}>
              {z.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        <Plus className="size-4" /> Add market
      </Button>
    </form>
  )
}
