'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Upload, ArrowRight, QrCode, Sparkles, RefreshCw } from 'lucide-react'
import { CREATIVE_ACCEPT, validateCreativeFile } from '@/lib/adCreative'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AdScreenPreview } from './AdScreenPreview'

// The top-of-funnel "that's my ad on a real TV" moment. A prospect drops in a logo
// or a photo/video and instantly sees it framed exactly as it airs on a Loop screen
// (the SAME AdScreenPreview render the TV uses), with an optional QR to their site.
// No account, no cart — pure proof-of-realness that hands off to /signup. Everything
// stays in the browser (object URLs); nothing is uploaded here.
export function PreviewStudio() {
  const [url, setUrl] = useState<string | null>(null)
  const [type, setType] = useState<'image' | 'video'>('image')
  const [site, setSite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Revoke the last object URL whenever it changes or the component unmounts.
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  function pick(file: File | null | undefined) {
    if (!file) return
    const problem = validateCreativeFile(file)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const next = URL.createObjectURL(file)
    urlRef.current = next
    setUrl(next)
    setType(file.type.startsWith('video/') ? 'video' : 'image')
  }

  // A QR only shows once they give a destination — same as a real ad.
  const qrUrl = site.trim() ? normalizeUrl(site.trim()) : null

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-center">
      {/* The TV */}
      <div className="flex flex-col items-center">
        <div className="w-full rounded-[1.4rem] bg-neutral-900 p-3 shadow-2xl ring-1 ring-white/10 sm:p-4">
          {url ? (
            <AdScreenPreview
              creativeUrl={url}
              creativeType={type}
              qrUrl={qrUrl}
              className="rounded-lg"
            />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-white/15 bg-black text-center transition hover:border-primary/50"
            >
              <span className="grid size-12 place-items-center rounded-full bg-primary/10">
                <Upload className="size-6 text-primary" />
              </span>
              <span className="px-6 text-sm text-muted-foreground">
                Drop in your logo, photo, or video
                <br />
                <span className="text-xs text-muted-foreground/70">
                  and watch it land on a Loop screen
                </span>
              </span>
            </button>
          )}
        </div>
        {/* Stand */}
        <div className="h-3 w-16 rounded-b-md bg-neutral-800" />
        <div className="h-1.5 w-40 rounded-full bg-neutral-800" />
        {url && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            This is exactly what plays on the TV, letterboxing and all.
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-5">
        <div className="space-y-2">
          <h2 className="font-heading text-2xl font-bold tracking-tight">
            See your business on a real screen.
          </h2>
          <p className="text-sm text-muted-foreground">
            Upload anything and see it framed exactly the way it airs on Loop TVs around town. No
            account needed.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={CREATIVE_ACCEPT}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(buttonVariants({ size: 'lg' }))}
          >
            {url ? (
              <>
                <RefreshCw className="size-4" /> Try another
              </>
            ) : (
              <>
                <Upload className="size-4" /> Upload your ad
              </>
            )}
          </button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <label htmlFor="preview-site" className="flex items-center gap-1.5 text-sm font-medium">
            <QrCode className="size-4 text-primary" /> Your website or booking link{' '}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="preview-site"
            type="text"
            inputMode="url"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="yourbusiness.com"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <p className="text-xs text-muted-foreground">
            Every Loop ad carries a scan code. Add a link to see yours on the screen.
          </p>
        </div>

        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> Like what you see?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick your screens on a map and go live in days. Don&apos;t have an ad ready? Our team can
            design one for you.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
              Start advertising <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/demo/advertiser"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              Take the tour
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// Accept a bare domain (yourbusiness.com) or a full URL and return something the QR
// can encode. We only prepend https:// — never validate hard, since this is a
// throwaway preview, not a saved ad.
function normalizeUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://${raw}`
}
