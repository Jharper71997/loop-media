'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { setCap } from './actions'

// Inline editable per-territory cap. Saves on blur when the value changed.
export function CapInput({
  territoryId,
  categoryId,
  initial,
}: {
  territoryId: string
  categoryId: string
  initial: number | null
}) {
  const [value, setValue] = useState(initial?.toString() ?? '')
  const [pending, start] = useTransition()
  const last = initial?.toString() ?? ''

  function save() {
    if (value === last) return
    const n = value === '' ? 0 : Number(value)
    if (Number.isNaN(n) || n < 0) {
      toast.error('Enter a number 0 or higher.')
      setValue(last)
      return
    }
    start(async () => {
      const res = await setCap(territoryId, categoryId, n)
      if (res.error) {
        toast.error(res.error)
        setValue(last)
      } else {
        toast.success('Cap saved')
      }
    })
  }

  return (
    <Input
      type="number"
      min={0}
      className="h-8 w-24"
      placeholder="none"
      value={value}
      disabled={pending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
