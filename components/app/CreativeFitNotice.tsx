'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Sparkles, CheckCircle2 } from 'lucide-react'

// Shown under a creative upload. Two layers:
//  1. Instant, free check — reads the image's real dimensions in the browser and
//     warns if it isn't ~16:9 or is too low-res to look sharp on a TV.
//  2. AI look (optional) — downscales the image and asks Claude whether it fills
//     the frame, has cut-off text, or is hard to read. No-ops if the server has
//     no ANTHROPIC_API_KEY (the /api/creative-check route returns {skipped}).
type AiVerdict = { fits: boolean; issues: string[]; suggestion: string }

export function CreativeFitNotice({ file }: { file: File | null }) {
  const [instant, setInstant] = useState<string | null>(null)
  const [ai, setAi] = useState<AiVerdict | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    setInstant(null)
    setAi(null)
    setChecking(false)
    if (!file || !file.type.startsWith('image/')) return // videos are usually already 16:9
    let alive = true
    const url = URL.createObjectURL(file)
    const img = new window.Image()

    img.onload = () => {
      if (!alive) {
        URL.revokeObjectURL(url)
        return
      }
      const w = img.naturalWidth
      const h = img.naturalHeight
      const off = Math.abs(w / h - 16 / 9) / (16 / 9)
      if (off > 0.12) {
        setInstant(
          `This image is ${w}×${h}. TVs are 16:9, so it'll show black bars or look stretched. Export at 1920×1080 for a flush fit.`
        )
      } else if (w < 1280 || h < 720) {
        setInstant(
          `This image is only ${w}×${h} and may look soft on a big screen. Use at least 1280×720 (1920×1080 is ideal).`
        )
      }

      // Downscale the same image for a quick AI look (keeps the payload small).
      const max = 1024
      const scale = Math.min(1, max / Math.max(w, h))
      const cw = Math.max(1, Math.round(w * scale))
      const ch = Math.max(1, Math.round(h * scale))
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      URL.revokeObjectURL(url)
      if (!ctx) return
      ctx.drawImage(img, 0, 0, cw, ch)
      const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? ''
      if (!base64) return

      setChecking(true)
      fetch('/api/creative-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base64, mediaType: 'image/jpeg' }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (alive && d && !d.skipped && !d.error) setAi(d as AiVerdict)
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setChecking(false)
        })
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url

    return () => {
      alive = false
    }
  }, [file])

  if (!file) return null
  const aiWarn = ai && (!ai.fits || ai.issues.length > 0)
  if (!instant && !checking && !ai) return null

  return (
    <div className="space-y-2">
      {instant && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{instant}</span>
        </div>
      )}
      {checking && !ai && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 animate-pulse" /> Checking how it looks on screen…
        </div>
      )}
      {aiWarn && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            {ai!.issues.length > 0 && <p>{ai!.issues.join(' ')}</p>}
            {ai!.suggestion && <p className="text-amber-100/80">{ai!.suggestion}</p>}
          </div>
        </div>
      )}
      {ai && ai.fits && ai.issues.length === 0 && !instant && (
        <div className="flex items-center gap-2 px-1 text-xs text-emerald-400">
          <CheckCircle2 className="size-3.5" /> Looks good full-screen.
        </div>
      )}
    </div>
  )
}
