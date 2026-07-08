// Shared image-composition helpers for the ad creative editors (the new-campaign
// CreativeStep and the campaign ReplaceCreative swap). Kept framework-free and
// pure so both editors crop/zoom/pan/filter with ONE coordinate system — the CSS
// preview and the exported PNG line up exactly. The export function touches the
// DOM (canvas), so only call it client-side.

// The exported creative is always rendered at 16:9 720p so the crop preview and
// the offscreen-canvas export share one coordinate system (see computeDraw).
export const EXPORT_W = 1280
export const EXPORT_H = 720

// Free-drag QR default — the QR CENTER as fractions of the frame. Roughly
// bottom-right, matching the old 'bottom-right' corner so placements don't jump.
export const QR_DEFAULT = { x: 0.9, y: 0.88 }

// QR SIZE — the QR (white chip) width as a fraction of the 16:9 frame width.
// The preview and the TV both render at this fraction so they match. Default
// applies to legacy ads (qr_size null) and new ads that don't set it.
export const QR_SIZE_DEFAULT = 0.09
export const QR_SIZE_MIN = 0.05
export const QR_SIZE_MAX = 0.18

// Filter presets are plain CSS filter strings. The SAME string is set on the
// preview <img> (style.filter) and on the export canvas (ctx.filter), so what the
// advertiser sees is what gets baked into the uploaded PNG.
export const FILTER_PRESETS = [
  { value: 'none', label: 'None', css: '' },
  { value: 'warm', label: 'Warm', css: 'sepia(0.35) saturate(1.25) hue-rotate(-12deg)' },
  { value: 'bw', label: 'B&W', css: 'grayscale(1)' },
  { value: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.08)' },
] as const
export type FilterPreset = (typeof FILTER_PRESETS)[number]['value']

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function buildFilter(preset: FilterPreset, brightness: number, contrast: number): string {
  const base = FILTER_PRESETS.find((p) => p.value === preset)?.css ?? ''
  return `${base} brightness(${brightness}%) contrast(${contrast}%)`.trim()
}

// Cover-fit the natural image into the WxH frame, then zoom about center and pan.
// Returns the draw rect in frame pixels — used for BOTH the CSS preview (as % of
// the frame) and the canvas export, so they line up exactly.
export function computeDraw(
  nat: { w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
  W: number,
  H: number
) {
  const base = Math.max(W / nat.w, H / nat.h) // cover
  const s = base * zoom
  const dw = nat.w * s
  const dh = nat.h * s
  const dx = (W - dw) / 2 + pan.x * W
  const dy = (H - dh) / 2 + pan.y * H
  return { dx, dy, dw, dh }
}

// Keep the (zoomed) image fully covering the frame: pan is bounded by how much
// the drawn image overhangs each edge (as a fraction of the frame).
export function clampPan(
  nat: { w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
  W: number,
  H: number
) {
  const base = Math.max(W / nat.w, H / nat.h)
  const s = base * zoom
  const maxX = Math.max(0, (nat.w * s - W) / (2 * W))
  const maxY = Math.max(0, (nat.h * s - H) / (2 * H))
  return { x: clamp(pan.x, -maxX, maxX), y: clamp(pan.y, -maxY, maxY) }
}

// Composite the cropped + filtered photo to a 1280x720 PNG. The QR is NEVER baked
// in (the TV draws a tracked QR at play time) — only the photo is drawn. Client-
// only (uses canvas). `filterStr` must be the SAME string used on the preview img.
export async function exportImageBlob(
  src: string,
  opts: { zoom: number; pan: { x: number; y: number }; filterStr: string }
): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new window.Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('Could not read image.'))
    im.src = src
  })
  const dims = { w: img.naturalWidth, h: img.naturalHeight }
  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_W
  canvas.height = EXPORT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available.')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, EXPORT_W, EXPORT_H)
  ctx.filter = opts.filterStr // same string as the preview img
  const d = computeDraw(dims, opts.zoom, opts.pan, EXPORT_W, EXPORT_H)
  ctx.drawImage(img, d.dx, d.dy, d.dw, d.dh)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('Could not render image.')
  return blob
}
