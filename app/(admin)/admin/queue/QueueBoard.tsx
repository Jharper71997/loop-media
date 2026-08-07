'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ImageOff, Search, Check, Keyboard, MapPin, AlertTriangle, Mail, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCents, formatDateTime } from '@/lib/format'
import { MAX_CREATIVE_MB } from '@/lib/adCreative'
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
  // Venues the advertiser picked — where this ad runs the moment it's approved.
  venues: { name: string; screens: number; live: boolean }[]
  // Who to reach when the answer is "fix this and resubmit".
  ownerEmail: string | null
  ownerPhone: string | null
  // What the player will do with it: the slot it holds, and the file it has to
  // pull down over venue WiFi. Both decide whether the spot actually airs.
  durationSeconds: number
  fileBytes: number | null
  fileType: string | null
  // What approving it is worth, and whether the money behind it is healthy.
  monthlyCents: number | null
  campaignStatus: string | null
  subStatus: string | null
  liveAdCount: number
}

// Read off the creative itself once the browser has it: real pixel size, real
// clip length, and whether it decodes at all. None of this is stored on the ad
// row, and all three are ways a spot fails silently after approval.
type Measured = { w: number; h: number; secs: number | null; broken?: boolean }

type Check = { level: 'stop' | 'warn'; text: string }

const DAY_MS = 86_400_000

// A 16:9 frame, within rounding slop. Anything else pillar/letterboxes on a TV.
const ASPECT_TOLERANCE = 0.05

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </div>
      <div className="truncate text-xs text-foreground">{value}</div>
    </div>
  )
}

function shortFormat(type: string | null, fallback: string): string {
  if (!type) return fallback.toUpperCase()
  const sub = type.split(';')[0].split('/')[1] ?? ''
  if (sub === 'quicktime') return 'MOV'
  if (sub === 'jpeg') return 'JPG'
  return sub.toUpperCase() || fallback.toUpperCase()
}

// Everything that would make this ad misbehave after it's approved, in the order
// it bites: nothing to play, plays nowhere, plays wrong, nobody's paying. 'stop'
// means approving it is a known-broken spot on a screen.
function reviewChecks(ad: QueueItem, m: Measured | undefined): Check[] {
  const out: Check[] = []
  if (!ad.creativeUrl) out.push({ level: 'stop', text: 'No creative uploaded — there is nothing to play.' })
  if (m?.broken)
    out.push({ level: 'stop', text: 'This file will not decode in a browser. Expect a black screen on the TV.' })
  const mb = ad.fileBytes ? ad.fileBytes / 1_000_000 : null
  if (mb && mb > MAX_CREATIVE_MB)
    out.push({
      level: 'stop',
      text: `${mb.toFixed(0)} MB is over the ${MAX_CREATIVE_MB} MB cap — players stall part way through the download.`,
    })
  if (ad.creativeType === 'video' && (ad.fileType ?? '').includes('quicktime'))
    out.push({
      level: 'warn',
      text: 'A .mov is usually HEVC, which a Fire Stick often cannot play. Ask for an MP4 (H.264).',
    })
  if (!ad.venues.length)
    out.push({ level: 'stop', text: 'No venue picked — approving this places it nowhere.' })
  for (const v of ad.venues) {
    if (!v.live) out.push({ level: 'warn', text: `${v.name} is not live, so nothing airs there yet.` })
    else if (v.screens === 0) out.push({ level: 'warn', text: `${v.name} has no screens paired.` })
  }
  if (!ad.qrTargetUrl)
    out.push({ level: 'warn', text: 'No scan destination — the QR on screen would lead nowhere.' })
  if (m?.secs && m.secs > ad.durationSeconds + 0.5)
    out.push({
      level: 'warn',
      text: `The clip runs ${m.secs.toFixed(0)}s but the slot is ${ad.durationSeconds}s — the player cuts it off.`,
    })
  if (m && m.w > 0) {
    if (Math.abs(m.w / m.h - 16 / 9) > ASPECT_TOLERANCE)
      out.push({ level: 'warn', text: `${m.w}×${m.h} is not 16:9 — it will sit in black bars.` })
    else if (m.w < 1280) out.push({ level: 'warn', text: `${m.w}px wide looks soft stretched to 1080p.` })
  }
  if (!ad.isPaid)
    out.push({ level: 'warn', text: 'No active campaign behind this — approving airs it for free.' })
  if (ad.subStatus === 'past_due' || ad.subStatus === 'unpaid')
    out.push({ level: 'warn', text: `Their subscription is ${ad.subStatus.replace('_', ' ')} in Stripe.` })
  return out
}

// Client board for the approval queue: keyboard-first review (J/K move, A
// approve, R reject), a live filter, bulk "approve all shown", plus decision
// context (paid?, territory, advertiser link, waiting-time) on every card.
export function QueueBoard({ ads, nowMs }: { ads: QueueItem[]; nowMs: number }) {
  const router = useRouter()
  const [items, setItems] = useState(ads)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(0)
  const [measured, setMeasured] = useState<Record<string, Measured>>({})
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
        a.category.toLowerCase().includes(q) ||
        a.venues.some((v) => v.name.toLowerCase().includes(q))
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

  // Ads that would air broken (or not at all) if approved as they stand.
  const flagged = useMemo(
    () => shown.filter((a) => reviewChecks(a, measured[a.id]).some((c) => c.level === 'stop')),
    [shown, measured]
  )

  function approveAllShown() {
    if (!shown.length) return
    if (
      flagged.length &&
      !window.confirm(
        `${flagged.length} of these ${shown.length} would break on screen (${flagged
          .map((a) => a.title)
          .join(', ')}). Approve all anyway?`
      )
    )
      return
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
            placeholder="Filter by advertiser, title, category, or venue…"
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
        {flagged.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <AlertTriangle className="size-3.5" /> {flagged.length} would break on screen
          </span>
        )}
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
            const m = measured[ad.id]
            const checks = reviewChecks(ad, m)
            const stops = checks.filter((c) => c.level === 'stop').length
            const megabytes = ad.fileBytes ? ad.fileBytes / 1_000_000 : null
            const screens = ad.venues.reduce((n, v) => n + v.screens, 0)
            const measure = (next: Measured) =>
              setMeasured((prev) => (prev[ad.id] ? prev : { ...prev, [ad.id]: next }))
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
                      <video
                        src={ad.creativeUrl}
                        className="h-full w-full object-contain"
                        controls
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                          const v = e.currentTarget
                          measure({
                            w: v.videoWidth,
                            h: v.videoHeight,
                            secs: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null,
                          })
                        }}
                        onError={() => measure({ w: 0, h: 0, secs: null, broken: true })}
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ad.creativeUrl}
                        alt={ad.title}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain"
                        onLoad={(e) =>
                          measure({
                            w: e.currentTarget.naturalWidth,
                            h: e.currentTarget.naturalHeight,
                            secs: null,
                          })
                        }
                        onError={() => measure({ w: 0, h: 0, secs: null, broken: true })}
                      />
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

                  {/* What it earns, and whether this advertiser is already on air.
                      "Unpaid" alone can't tell a comped spot from a lapsed card. */}
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                    <span className="font-medium text-foreground">
                      {ad.monthlyCents ? `${formatCents(ad.monthlyCents)}/mo` : 'No price on file'}
                    </span>
                    <span className="text-muted-foreground">
                      {ad.campaignStatus ? `campaign ${ad.campaignStatus}` : 'no campaign'}
                      {ad.subStatus ? ` · Stripe ${ad.subStatus.replace('_', ' ')}` : ''}
                    </span>
                    <span className="text-muted-foreground">
                      ·{' '}
                      {ad.liveAdCount === 0
                        ? 'first ad from them'
                        : `${ad.liveAdCount} already running`}
                    </span>
                  </div>

                  {/* The hard facts about the file. The TV cares about all four and
                      the ad row records only the slot length. */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-background/60 p-2.5">
                    <Spec label="Slot" value={`${ad.durationSeconds}s`} />
                    <Spec
                      label="Clip"
                      value={
                        ad.creativeType !== 'video'
                          ? 'still image'
                          : m?.secs
                            ? `${m.secs.toFixed(0)}s`
                            : m?.broken
                              ? 'unreadable'
                              : 'reading…'
                      }
                    />
                    <Spec
                      label="File"
                      value={
                        shortFormat(ad.fileType, ad.creativeType) +
                        (megabytes ? ` · ${megabytes.toFixed(1)} MB` : '')
                      }
                    />
                    <Spec
                      label="Pixels"
                      value={
                        m && m.w > 0 ? `${m.w}×${m.h}` : m?.broken ? 'unreadable' : 'reading…'
                      }
                    />
                  </div>

                  <div className="rounded-lg border border-border bg-background/60 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <MapPin className="size-3.5" />
                      Runs at{' '}
                      {ad.venues.length
                        ? `(${ad.venues.length} · ${screens} screen${screens === 1 ? '' : 's'})`
                        : ''}
                    </div>
                    {ad.venues.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {ad.venues.map((v) => (
                          <li key={v.name} className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">
                              {v.name}
                              {!v.live && <span className="text-warning"> · venue not live</span>}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {v.screens} screen{v.screens === 1 ? '' : 's'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1.5 text-sm text-muted-foreground">Nowhere — no venue picked.</p>
                    )}
                  </div>

                  {checks.length > 0 && (
                    <div
                      className={
                        'rounded-lg border p-2.5 ' +
                        (stops
                          ? 'border-destructive/30 bg-destructive/10'
                          : 'border-warning/30 bg-warning/10')
                      }
                    >
                      <div
                        className={
                          'flex items-center gap-1.5 text-xs font-medium ' +
                          (stops ? 'text-destructive' : 'text-warning')
                        }
                      >
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {stops
                          ? `${stops} thing${stops === 1 ? '' : 's'} would break on screen`
                          : 'Worth knowing before you approve'}
                      </div>
                      <ul className="mt-1.5 space-y-1 text-xs text-foreground">
                        {checks.map((c) => (
                          <li key={c.text} className="flex gap-1.5">
                            <span
                              className={
                                'mt-1.5 size-1 shrink-0 rounded-full ' +
                                (c.level === 'stop' ? 'bg-destructive' : 'bg-warning')
                              }
                            />
                            <span>{c.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <QrTargetEditor adId={ad.id} initialUrl={ad.qrTargetUrl} />

                  {/* Reject means someone has to tell them what to fix, so the way
                      to reach them belongs on the card and not two clicks away. */}
                  {(ad.ownerEmail || ad.ownerPhone) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {ad.ownerEmail && (
                        <a
                          href={`mailto:${ad.ownerEmail}`}
                          className="flex min-w-0 items-center gap-1 hover:text-foreground hover:underline"
                        >
                          <Mail className="size-3 shrink-0" />
                          <span className="truncate">{ad.ownerEmail}</span>
                        </a>
                      )}
                      {ad.ownerPhone && (
                        <a
                          href={`tel:${ad.ownerPhone}`}
                          className="flex items-center gap-1 hover:text-foreground hover:underline"
                        >
                          <Phone className="size-3 shrink-0" />
                          {ad.ownerPhone}
                        </a>
                      )}
                    </div>
                  )}

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
