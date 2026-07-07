'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ImageOff, Search, Check, Keyboard } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/format'
import { QrTargetEditor } from './QrTargetEditor'
import { ReviewButtons } from './ReviewButtons'
import { approveAd, rejectAd } from './actions'

export type QueueItem = {
  id: string
  title: string
  ownerName: string
  ownerId: string | null
  ownerKind: string
  category: string
  territory: string | null
  createdAt: string
  isPaid: boolean
  creativeUrl: string | null
  creativeType: string
  qrTargetUrl: string | null
}

const DAY_MS = 86_400_000

// Client board for the approval queue: keyboard-first review (J/K move, A
// approve, R reject), a live filter, bulk "approve all shown", plus decision
// context (paid?, territory, advertiser link, waiting-time) on every card.
export function QueueBoard({ ads, nowMs }: { ads: QueueItem[]; nowMs: number }) {
  const router = useRouter()
  const [items, setItems] = useState(ads)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(0)
  const [pending, start] = useTransition()
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  // Re-sync when the server revalidates (approve/reject refreshes the page).
  useEffect(() => setItems(ads), [ads])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.ownerName.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    )
  }, [items, query])

  const clampedFocus = Math.min(focus, Math.max(0, shown.length - 1))

  function approve(id: string) {
    setItems((xs) => xs.filter((a) => a.id !== id))
    start(async () => {
      const res = await approveAd(id)
      if (res.error) {
        toast.error(res.error)
        setItems(ads)
      } else {
        toast.success('Ad approved')
        router.refresh()
      }
    })
  }

  function reject(id: string, reason: string) {
    setItems((xs) => xs.filter((a) => a.id !== id))
    start(async () => {
      const res = await rejectAd(id, reason)
      if (res.error) {
        toast.error(res.error)
        setItems(ads)
      } else {
        toast.success('Ad rejected')
        router.refresh()
      }
    })
  }

  function approveAllShown() {
    if (!shown.length) return
    const ids = shown.map((a) => a.id)
    setItems((xs) => xs.filter((a) => !ids.includes(a.id)))
    start(async () => {
      let ok = 0
      for (const id of ids) {
        const res = await approveAd(id)
        if (!res.error) ok++
      }
      toast.success(`Approved ${ok} ad${ok === 1 ? '' : 's'}`)
      router.refresh()
    })
  }

  // Keyboard review. Ignored while typing in the filter or the QR editor.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (!shown.length) return
      const cur = shown[clampedFocus]
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setFocus((f) => Math.min(shown.length - 1, f + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocus((f) => Math.max(0, f - 1))
      } else if (e.key === 'a' && cur) {
        e.preventDefault()
        approve(cur.id)
      } else if (e.key === 'r' && cur) {
        e.preventDefault()
        const reason = window.prompt('Reason for rejection (shown to the advertiser):')
        if (reason !== null) reject(cur.id, reason)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown, clampedFocus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the focused card in view as you J/K through the list.
  useEffect(() => {
    cardRefs.current[clampedFocus]?.scrollIntoView({ block: 'nearest' })
  }, [clampedFocus])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by advertiser, title, or category…"
            className="h-10 pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || shown.length === 0}
          onClick={approveAllShown}
        >
          <Check className="size-4" /> Approve all shown ({shown.length})
        </Button>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Keyboard className="size-3.5" /> J/K move · A approve · R reject
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
          {items.length === 0 ? '🎉 Nothing to review. The queue is empty.' : 'No ads match your filter.'}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((ad, i) => {
            const waitedMs = nowMs - new Date(ad.createdAt).getTime()
            const aging = waitedMs > DAY_MS
            return (
              <div
                key={ad.id}
                ref={(el) => {
                  cardRefs.current[i] = el
                }}
                onClick={() => setFocus(i)}
                className={
                  'flex flex-col overflow-hidden rounded-lg border bg-card transition ' +
                  (i === clampedFocus ? 'border-primary ring-1 ring-primary' : 'border-border')
                }
              >
                <div className="relative flex aspect-video items-center justify-center bg-black">
                  {ad.creativeUrl ? (
                    ad.creativeType === 'video' ? (
                      <video src={ad.creativeUrl} className="h-full w-full object-contain" controls muted playsInline />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ad.creativeUrl} alt={ad.title} className="h-full w-full object-contain" />
                    )
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <ImageOff className="size-6" />
                      <span className="text-xs">No creative uploaded</span>
                    </div>
                  )}
                  <Badge className="absolute top-2 left-2 capitalize" variant="secondary">
                    {ad.creativeType}
                  </Badge>
                  {aging && (
                    <Badge className="absolute top-2 right-2" variant="warning">
                      Waiting &gt;24h
                    </Badge>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <div className="font-medium">{ad.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {ad.ownerId ? (
                        <Link href={`/admin/advertisers/${ad.ownerId}`} className="hover:underline">
                          {ad.ownerName}
                        </Link>
                      ) : (
                        ad.ownerName
                      )}{' '}
                      · {ad.category}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline" className="capitalize">
                      {ad.ownerKind}
                    </Badge>
                    <Badge variant={ad.isPaid ? 'success' : 'outline'}>
                      {ad.isPaid ? 'Paid' : 'Unpaid'}
                    </Badge>
                    {ad.territory && <span>{ad.territory}</span>}
                    <span>· {formatDateTime(ad.createdAt)}</span>
                  </div>
                  <QrTargetEditor adId={ad.id} initialUrl={ad.qrTargetUrl} />
                  <div className="mt-auto pt-1">
                    <ReviewButtons id={ad.id} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
