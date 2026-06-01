'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateAdvertiserProfile } from './actions'

type TerritoryOption = { id: string; name: string }

export function EditAdvertiserDialog({
  id,
  fullName,
  phone,
  territoryId,
  territories,
}: {
  id: string
  fullName: string | null
  phone: string | null
  territoryId: string | null
  territories: TerritoryOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [name, setName] = useState(fullName ?? '')
  const [ph, setPh] = useState(phone ?? '')
  const [terr, setTerr] = useState(territoryId ?? 'none')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await updateAdvertiserProfile(id, {
        full_name: name,
        phone: ph,
        territory_id: terr === 'none' ? null : terr,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Advertiser updated')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" /> Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit advertiser</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Phone</Label>
            <Input value={ph} onChange={(e) => setPh(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Territory</Label>
            <Select value={terr} onValueChange={(v) => setTerr(v ?? 'none')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    v && v !== 'none'
                      ? territories.find((x) => x.id === v)?.name ?? 'Territory'
                      : 'Unassigned'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {territories.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
