'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { SlidersHorizontal, ChevronDown, RotateCw } from 'lucide-react'
import {
  drawCreative,
  creativeRect,
  buildFilter,
  clamp,
  FILTER_PRESETS,
  ZOOM_MIN,
  ZOOM_MAX,
  type CreativeTransform,
  type FilterPreset,
} from '@/lib/adCreative'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { QrChip } from './QrChip'

// A free-transform photo editor for TV creatives. The 16:9 frame IS the TV screen:
// the photo auto-fits (contain — whole image, black bars) on load, then the user
// drags to move, zooms in/out (slider/wheel/pinch), and grabs corner/top handles to
// resize — on a rule-of-thirds grid. Whatever sits in the frame is exactly what airs,
// because the live canvas preview and the exported PNG are drawn by the SAME
// `drawCreative` routine (only the resolution differs). Black bars in the preview ==
// black bars in the bake == black bars on the TV. The parent bakes on submit via
// exportImageBlob(src, editorRef.current.getExportParams()).

export interface CreativeImageEditorHandle {
  getExportParams: () => CreativeTransform | null
}

interface QrOverlay {
  src: string | null
  x: number
  y: number
  size: number
  interactive?: boolean
  onMove?: (x: number, y: number) => void
}

type Corner = { anchorX: 'left' | 'right' | 'center'; anchorY: 'top' | 'bottom'; verticalOnly?: boolean; cursor: string }

// Each handle resizes about the OPPOSITE anchor (which stays pinned).
const HANDLES: Record<string, Corner> = {
  tl: { anchorX: 'right', anchorY: 'bottom', cursor: 'nwse-resize' },
  tr: { anchorX: 'left', anchorY: 'bottom', cursor: 'nesw-resize' },
  bl: { anchorX: 'right', anchorY: 'top', cursor: 'nesw-resize' },
  br: { anchorX: 'left', anchorY: 'top', cursor: 'nwse-resize' },
  t: { anchorX: 'center', anchorY: 'bottom', verticalOnly: true, cursor: 'ns-resize' },
}

export const CreativeImageEditor = forwardRef<CreativeImageEditorHandle, {
  src: string
  qr?: QrOverlay
  className?: string
}>(function CreativeImageEditor({ src, qr, className }, ref) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [rotation, setRotation] = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [preset, setPreset] = useState<FilterPreset>('none')
  const [showAdjust, setShowAdjust] = useState(false)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)

  const filterStr = buildFilter(preset, brightness, contrast)
  const transform: CreativeTransform = { zoom, pan, rotation, fit: 'contain', filterStr }

  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const natRef = useRef<{ w: number; h: number } | null>(null)

  // Load the image and reset the transform whenever the source changes. init zoom=1
  // with fit:'contain' = the auto-fit (whole image inside 16:9, black bars).
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setRotation(0)
    setBrightness(100)
    setContrast(100)
    setPreset('none')
    setShowAdjust(false)
    imgRef.current = null
    natRef.current = null
    setNat(null)
    if (!src) return
    let alive = true
    const im = new window.Image()
    im.onload = () => {
      if (!alive) return
      imgRef.current = im
      const d = { w: im.naturalWidth, h: im.naturalHeight }
      natRef.current = d
      setNat(d)
    }
    im.src = src
    return () => {
      alive = false
    }
  }, [src])

  // The single render routine, shared with the export bake.
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = imgRef.current
    if (!img) {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return
    }
    drawCreative(ctx, img, { zoom, pan, rotation, fit: 'contain', filterStr }, canvas.width, canvas.height)
  }, [zoom, pan, rotation, filterStr])

  const drawRef = useRef(draw)
  drawRef.current = draw

  // Size the canvas to its rendered box (dpr-aware) and redraw on resize.
  useLayoutEffect(() => {
    const frame = frameRef.current
    const canvas = canvasRef.current
    if (!frame || !canvas) return
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(frame.clientWidth * dpr))
      canvas.height = Math.max(1, Math.round(frame.clientHeight * dpr))
      drawRef.current()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(frame)
    return () => ro.disconnect()
  }, [])

  // Redraw whenever the transform (or the loaded image) changes.
  useEffect(() => {
    const id = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(id)
  }, [draw, nat])

  useImperativeHandle(
    ref,
    () => ({
      getExportParams: () => (natRef.current ? { zoom, pan, rotation, fit: 'contain', filterStr } : null),
    }),
    [zoom, pan, rotation, filterStr]
  )

  // ---- Pan (1 pointer) + pinch-zoom (2 pointers) on the frame ----
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null)

  function onFramePointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom }
      panStart.current = null
    } else {
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    }
  }
  function onFramePointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const frame = frameRef.current
    if (!frame) return
    const r = frame.getBoundingClientRect()
    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      setZoom(clamp(pinchStart.current.zoom * (d / pinchStart.current.dist), ZOOM_MIN, ZOOM_MAX))
    } else if (panStart.current && r.width && r.height) {
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x) / r.width,
        y: panStart.current.panY + (e.clientY - panStart.current.y) / r.height,
      })
    }
  }
  function onFramePointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
    if (pointers.current.size === 0) panStart.current = null
    else {
      const [p] = [...pointers.current.values()]
      panStart.current = { x: p.x, y: p.y, panX: pan.x, panY: pan.y }
    }
  }

  // Wheel zoom — native non-passive listener so we can preventDefault the page scroll.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX))
    }
    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [])

  // ---- Corner / top-edge resize handles ----
  function onHandleDown(e: React.PointerEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    const frame = frameRef.current
    const n = natRef.current
    if (!frame || !n) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const cfg = HANDLES[id]
    const rect = creativeRect(n, { zoom, pan, rotation, fit: 'contain', filterStr })
    // Fractional size at zoom=1 (so w'/h' = unit * zoom' during the drag).
    const unit = creativeRect(n, { zoom: 1, pan: { x: 0, y: 0 }, rotation, fit: 'contain', filterStr })
    const w1 = unit.w
    const h1 = unit.h
    // The anchor point that stays pinned while dragging this handle.
    const Ax =
      cfg.anchorX === 'left' ? rect.x : cfg.anchorX === 'right' ? rect.x + rect.w : rect.x + rect.w / 2
    const Ay = cfg.anchorY === 'top' ? rect.y : rect.y + rect.h

    const move = (ev: PointerEvent) => {
      const r = frame.getBoundingClientRect()
      if (!r.width || !r.height) return
      const px = (ev.clientX - r.left) / r.width
      const py = (ev.clientY - r.top) / r.height
      const sx =
        cfg.anchorX === 'left'
          ? (px - Ax) / w1
          : cfg.anchorX === 'right'
            ? (Ax - px) / w1
            : (2 * Math.abs(px - Ax)) / w1
      const sy = cfg.anchorY === 'top' ? (py - Ay) / h1 : (Ay - py) / h1
      const z = clamp(cfg.verticalOnly ? sy : Math.max(sx, sy), ZOOM_MIN, ZOOM_MAX)
      const w = w1 * z
      const h = h1 * z
      const rx = cfg.anchorX === 'left' ? Ax : cfg.anchorX === 'right' ? Ax - w : Ax - w / 2
      const ry = cfg.anchorY === 'top' ? Ay : Ay - h
      setZoom(z)
      setPan({ x: rx - (1 - w) / 2, y: ry - (1 - h) / 2 })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const rect = nat ? creativeRect(nat, transform) : null
  const handlePos: Record<string, { x: number; y: number }> = rect
    ? {
        tl: { x: rect.x, y: rect.y },
        tr: { x: rect.x + rect.w, y: rect.y },
        bl: { x: rect.x, y: rect.y + rect.h },
        br: { x: rect.x + rect.w, y: rect.y + rect.h },
        t: { x: rect.x + rect.w / 2, y: rect.y },
      }
    : {}

  function rotate90() {
    setRotation((r) => {
      const n = r + 90
      return n > 180 ? n - 360 : n
    })
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div
        ref={frameRef}
        onPointerDown={onFramePointerDown}
        onPointerMove={onFramePointerMove}
        onPointerUp={onFramePointerUp}
        onPointerCancel={onFramePointerUp}
        className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-lg bg-black"
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-move" />

        {/* Rule-of-thirds grid, like a normal photo editor. */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
        </div>

        {/* Resize handles — 44px touch targets with a small visible knob. */}
        {rect &&
          Object.entries(HANDLES).map(([id, cfg]) => (
            <button
              key={id}
              type="button"
              aria-label={`Resize ${id}`}
              onPointerDown={(e) => onHandleDown(e, id)}
              className="absolute z-20 flex size-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center"
              style={{ left: `${handlePos[id].x * 100}%`, top: `${handlePos[id].y * 100}%`, cursor: cfg.cursor }}
            >
              <span className="size-3.5 rounded-sm border-2 border-white bg-primary shadow-[0_1px_4px_rgba(0,0,0,.6)]" />
            </button>
          ))}

        {/* The scan QR, exactly as it airs (drawn as a live overlay, never baked). */}
        {qr && (
          <QrChip
            src={qr.src}
            x={qr.x}
            y={qr.y}
            size={qr.size}
            interactive={qr.interactive}
            onMove={qr.onMove}
          />
        )}
      </div>

      {/* Zoom is always visible so shrinking BELOW fill (to show the whole photo) is
          obvious — not just zooming in. */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Zoom</Label>
          <span className="text-xs text-muted-foreground">{zoom.toFixed(1)}×</span>
        </div>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-primary"
        />
        <p className="text-xs text-muted-foreground">
          Drag the photo to move it, drag a corner to resize, or zoom out to fit the whole image
          (empty space shows as black on the TV).
        </p>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowAdjust((s) => !s)}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm font-medium transition hover:border-primary/40"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" /> Adjust photo
          </span>
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', showAdjust && 'rotate-180')} />
        </button>
        {showAdjust && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Rotation</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{Math.round(rotation)}°</span>
                  <button
                    type="button"
                    onClick={rotate90}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:border-primary/40"
                  >
                    <RotateCw className="size-3.5" /> 90°
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Brightness</Label>
                  <span className="text-xs text-muted-foreground">{brightness}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={1}
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer accent-primary"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Contrast</Label>
                  <span className="text-xs text-muted-foreground">{contrast}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={1}
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer accent-primary"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Filter</Label>
              <div className="grid grid-cols-4 gap-2">
                {FILTER_PRESETS.map((p) => (
                  <Button
                    key={p.value}
                    type="button"
                    variant={preset === p.value ? 'secondary' : 'outline'}
                    className="h-10"
                    onClick={() => setPreset(p.value)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
