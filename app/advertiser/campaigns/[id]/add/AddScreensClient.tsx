'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatCents } from '@/lib/format'
import { addScreensToCampaign } from '../actions'

type V = { id: string; name: string; city: string | null; state: string | null }

export function AddScreensClient({ campaignId, venues }: { campaignId: string; venues: V[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, start] = useTransition()

  const toggle = (vid: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(vid)) n.delete(vid)
      else n.add(vid)
      return n
    })

  const submit = () => {
    if (!selected.size) return
    start(async () => {
      const res = await addScreensToCampaign(campaignId, [...selected])
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        `Added ${res.added} screen${res.added === 1 ? '' : 's'}${
          res.newMonthlyCents != null ? ` — new total ${formatCents(res.newMonthlyCents)}/mo` : ''
        }`
      )
      router.push(`/advertiser/campaigns/${campaignId}`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <Button onClick={submit} disabled={!selected.size || pending} size="lg" className="h-12 w-full">
        {pending
          ? 'Adding…'
          : selected.size
            ? `Add ${selected.size} screen${selected.size === 1 ? '' : 's'}`
            : 'Select screens to add'}
      </Button>
      <p className="text-xs text-muted-foreground">
        We&apos;ll prorate the difference onto your next invoice; your monthly total updates right
        away.
      </p>

      {venues.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No more screens are available in this market right now.
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="divide-y divide-border p-0">
            {venues.map((v) => {
              const on = selected.has(v.id)
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggle(v.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition',
                    on ? 'bg-primary/10' : 'hover:bg-muted/50'
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{v.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[v.city, v.state].filter(Boolean).join(', ') || 'Local venue'}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full border',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                    )}
                  >
                    {on && <Check className="size-4" />}
                  </span>
                </button>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
