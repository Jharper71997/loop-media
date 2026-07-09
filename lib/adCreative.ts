// Shared image-composition helpers for the ad creative editors (the new-campaign
// CreativeStep and the campaign ReplaceCreative swap). Kept framework-free and
// pure so both editors crop/zoom/pan/filter with ONE coordinate system — the CSS
// preview and the exported PNG line up exactly. The export function touches the
// DOM (canvas), so only call it client-side.

// The exported creative is always rendered at 16:9 1080p — crisp on big TVs.
// exportImageBlob does a programmatic cover-crop (no editor); getCroppedImg bakes
// the react-easy-crop selection. Both composite onto this same fixed frame.
export const EXPORT_W = 1920
export const EXPORT_H = 1080

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

// ---- Upload guards for advertiser creatives ----
// A video must be a web-safe container the TV's browser can decode. A phone's .mov
// (or an HEVC file) can preview fine on the advertiser's device yet silently fail to
// play on the Fire Stick — so the ad they paid for never runs. We steer/accept only
// mp4 + webm, and cap size so a creative loads fast over a venue's WiFi. Images pass
// (they're re-encoded to a 16:9 PNG on upload). Use CREATIVE_ACCEPT on the file input
// and validateCreativeFile() on selection in every uploader so the rule stays in one place.
export const MAX_CREATIVE_MB = 50
export const OK_VIDEO_TYPES = ['video/mp4', 'video/webm']
export const CREATIVE_ACCEPT = 'image/*,video/mp4,video/webm'

export function validateCreativeFile(file: File): string | null {
  if (file.size > MAX_CREATIVE_MB * 1_000_000) {
    return `That file is ${(file.size / 1_000_000).toFixed(0)} MB. Keep it under ${MAX_CREATIVE_MB} MB so it loads fast on the venue's screen.`
  }
  const isVideo = file.type.startsWith('video/')
  const isImage = file.type.startsWith('image/')
  if (!isVideo && !isImage) return 'Upload an image or a video file.'
  if (isVideo && !OK_VIDEO_TYPES.includes(file.type)) {
    return 'Please upload an MP4 (H.264) or WebM video. Other formats — like a .mov from an iPhone — may not play on the TV.'
  }
  return null
}

// ---- Venue logo (host business logo on the browse map) ----
// A logo is a square PNG (transparent background preserved) so it renders cleanly
// as a round map pin and a small avatar in the popup. Images only — no video, and
// no SVG (it can't be reliably raster-cropped to a canvas). 512px is plenty for a
// pin/avatar and keeps the file small. Use LOGO_ACCEPT on the input and
// validateLogoFile() on selection; getCroppedLogoImg() bakes the square crop.
export const LOGO_SIZE = 512
export const MAX_LOGO_MB = 5
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp'
const OK_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function validateLogoFile(file: File): string | null {
  if (file.size > MAX_LOGO_MB * 1_000_000) {
    return `That image is ${(file.size / 1_000_000).toFixed(0)} MB. Keep your logo under ${MAX_LOGO_MB} MB.`
  }
  if (!OK_LOGO_TYPES.includes(file.type)) {
    return 'Upload a PNG, JPG, or WebP image for your logo.'
  }
  return null
}

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

// Composite the cover-cropped + filtered photo to a 16:9 PNG. The QR is NEVER baked
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

// ---- Editor-driven crop (react-easy-crop) ----
// The Cropper reports the selected region as pixel coords in the (rotated) media's
// own space. We rotate the source onto a bounding-box canvas, then draw the selected
// region — scaled to the fixed 16:9 output and filtered — so the baked PNG matches
// what the advertiser framed. QR stays a render-time overlay (never baked). Client-only.
function createImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new window.Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('Could not read image.'))
    im.src = src
  })
}

const toRad = (deg: number) => (deg * Math.PI) / 180

// Size of an image's bounding box once rotated by `deg`, so rotation never clips it.
function rotatedBox(w: number, h: number, deg: number) {
  const r = toRad(deg)
  return {
    w: Math.abs(Math.cos(r) * w) + Math.abs(Math.sin(r) * h),
    h: Math.abs(Math.sin(r) * w) + Math.abs(Math.cos(r) * h),
  }
}

export async function getCroppedImg(
  src: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  rotation: number,
  filterStr: string
): Promise<Blob> {
  const img = await createImage(src)
  const nw = img.naturalWidth
  const nh = img.naturalHeight

  // Stage 1: draw the (rotated) full image onto a canvas sized to its bounding box.
  const box = rotatedBox(nw, nh, rotation)
  const stage = document.createElement('canvas')
  stage.width = Math.round(box.w)
  stage.height = Math.round(box.h)
  const sctx = stage.getContext('2d')
  if (!sctx) throw new Error('Canvas is not available.')
  sctx.translate(stage.width / 2, stage.height / 2)
  sctx.rotate(toRad(rotation))
  sctx.drawImage(img, -nw / 2, -nh / 2)

  // Stage 2: draw the cropped region, scaled to the fixed frame, with the filter.
  const out = document.createElement('canvas')
  out.width = EXPORT_W
  out.height = EXPORT_H
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Canvas is not available.')
  octx.fillStyle = '#000000'
  octx.fillRect(0, 0, EXPORT_W, EXPORT_H)
  octx.filter = filterStr // same string as the preview media
  octx.drawImage(
    stage,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    EXPORT_W,
    EXPORT_H
  )

  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
  if (!blob) throw new Error('Could not render image.')
  return blob
}

// Bake a react-easy-crop selection into a SQUARE LOGO_SIZE PNG. Same two-stage
// rotate-then-crop as getCroppedImg, but the output is square and the background
// is left TRANSPARENT (no black fill) so a logo with transparency stays clean as
// a round map pin. No filter — logos aren't color-graded. Client-only (canvas).
export async function getCroppedLogoImg(
  src: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  rotation: number
): Promise<Blob> {
  const img = await createImage(src)
  const nw = img.naturalWidth
  const nh = img.naturalHeight

  const box = rotatedBox(nw, nh, rotation)
  const stage = document.createElement('canvas')
  stage.width = Math.round(box.w)
  stage.height = Math.round(box.h)
  const sctx = stage.getContext('2d')
  if (!sctx) throw new Error('Canvas is not available.')
  sctx.translate(stage.width / 2, stage.height / 2)
  sctx.rotate(toRad(rotation))
  sctx.drawImage(img, -nw / 2, -nh / 2)

  const out = document.createElement('canvas')
  out.width = LOGO_SIZE
  out.height = LOGO_SIZE
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Canvas is not available.')
  // No fillRect — keep the background transparent for the round pin.
  octx.drawImage(
    stage,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    LOGO_SIZE,
    LOGO_SIZE
  )

  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
  if (!blob) throw new Error('Could not render image.')
  return blob
}
