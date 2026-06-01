'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'

// Generic inline number field that saves on blur / Enter when the value changed.
// Generalizes the categories CapInput so the detail pages can edit goals, caps,
// prices, etc. `action` receives null when the field is cleared (if allowEmpty).
export function InlineNumber({
  initial,
  action,
  allowEmpty = true,
  min = 0,
  className = 'h-8 w-28',
  placeholder = 'none',
}: {
  initial: number | null
  action: (value: number | null) => Promise<{ error: string | null }>
  allowEmpty?: boolean
  min?: number
  className?: string
  placeholder?: string
}) {
  const [value, setValue] = useState(initial?.toString() ?? '')
  const [pending, start] = useTransition()
  const last = initial?.toString() ?? ''

  function save() {
    if (value === last) return
    let n: number | null
    if (value === '') {
      if (!allowEmpty) {
        toast.error('Enter a number.')
        setValue(last)
        return
      }
      n = null
    } else {
      n = Number(value)
      if (Number.isNaN(n) || n < min) {
        toast.error(`Enter a number ${min} or higher.`)
        setValue(last)
        return
      }
    }
    start(async () => {
      const res = await action(n)
      if (res.error) {
        toast.error(res.error)
        setValue(last)
      } else {
        toast.success('Saved')
      }
    })
  }

  return (
    <Input
      type="number"
      min={min}
      className={className}
      placeholder={placeholder}
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
