'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createTerritory } from './actions'

// A market is a state, so the state is the only thing asked for: "NC" or "North
// Carolina" both land on the North Carolina market, with its timezone. Never a city
// — venues in a new town join their state's market (county is tracked on the venue).
export function NewTerritory() {
  const router = useRouter()
  const [state, setState] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!state.trim()) return
    start(async () => {
      const res = await createTerritory({ state })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`${res.name} added.`)
      setState('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        className="h-8 w-44"
        placeholder="State, e.g. NC"
        value={state}
        onChange={(e) => setState(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={pending}>
        <Plus className="size-4" /> Add market
      </Button>
    </form>
  )
}
