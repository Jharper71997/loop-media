'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCategory } from './actions'

export function AddCategory() {
  const [name, setName] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    start(async () => {
      const res = await createCategory(name)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Category added')
      setName('')
    })
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        className="h-8 w-48"
        placeholder="New category…"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={pending}>
        <Plus className="size-4" /> Add
      </Button>
    </form>
  )
}
