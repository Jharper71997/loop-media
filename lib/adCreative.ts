// Shared image-composition helpers for the ad creative editors (the new-campaign
// CreativeStep and the campaign ReplaceCreative swap). Kept framework-free and
// pure so both editors crop/zoom/pan/filter with ONE coordinate system — the CSS
// preview and the exported PNG line up exactly. The export function touches the
// DOM (canvas), so only call it client-side.

// The exported creative is always rendered at 16:9 1080p — crisp on big TVs.
// exportImageBlob bakes the editor's transform (drawCreative) onto this fixed frame;
// getCroppedLogoImg bakes the react-easy-crop logo selection to a square.
export const EXPORT_W = 1920
export const EXPORT_H = 1080

// Editor zoom bounds. ZOOM_MIN < 1 lets the user shrink the image BELOW the
// auto-fit so the whole photo sits inside the 16:9 frame with black bars (not
// just zoom in to crop); ZOOM_MAX caps how far they can zoom/crop in.
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4

// The scan QR is framed in fixed gold on the TV, which always renders dark. The
// advertiser/host editor app can be in LIGHT mode, where the `--primary` theme
// token resolves to bronze — so the shared QR chip uses this fixed value instead
// of the token, keeping the previewed frame color identical to what airs.
export const QR_GOLD = '#d4af37'

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
// .mov (video/quicktime) is accepted at upload, but it is NOT a safe TV format:
// an iPhone .mov is often HEVC/H.265, which many Fire Stick / TV WebViews can't
// decode — so it may preview fine on the advertiser's phone yet never air on the
// screen (the player skips a video it can't play). MP4 (H.264) / WebM remain the
// reliable formats; the uploader surfaces that caution when a .mov is chosen.
export const OK_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
// The `.mov` extension is listed alongside the MIME types because some OS file
// pickers match the accept filter by extension, not by reported MIME.
export const CREATIVE_ACCEPT = 'image/*,video/mp4,video/webm,video/quicktime,.mov'

// A chosen video whose format is accepted but risky on the TV (today: .mov). The
// uploader shows this as a non-blocking caution so the advertiser can still upload,
// but is told mp4 is the safe choice. Not an error — validateCreativeFile passes it.
export function riskyVideoNotice(file: File | null): string | null {
  if (!file) return null
  if (file.type === 'video/quicktime' || /\.mov$/i.test(file.name)) {
    return 'Heads up: .mov files (from an iPhone) may not play on some TVs. An MP4 (H.264) is the safest bet — but you can upload this and we’ll flag it in review if it won’t air.'
  }
  return null
}

// ---- Spot length ----
// A spot is sold as a 15-second slot, so that's the ceiling on what we store in
// ads.duration_seconds AND on what the TV will actually play (the player hard-cuts
// there). Without a ceiling a long upload airs in full and holds the loop for every
// other advertiser on that screen — a 3-minute clip meant 3 minutes of one ad.
export const MAX_SPOT_SECONDS = 15

// Whole seconds, clamped into (0, MAX_SPOT_SECONDS]. Rounds UP so a clip is never
// cut a hair early by its own stored length. ads.duration_seconds is
// `int not null check (> 0)`, so an unreadable file (0/NaN) must never reach the
// insert — those fall back to the full slot rather than failing the check.
export function clampSpotSeconds(secs: number): number {
  if (!Number.isFinite(secs) || secs <= 0) return MAX_SPOT_SECONDS
  return Math.min(Math.ceil(secs), MAX_SPOT_SECONDS)
}

// A video file's real length in seconds, read off its metadata in the browser, so
// an ad's duration_seconds reflects the actual clip instead of the DB default of 15.
// Resolves 0 when the browser can't read it (unsupported codec, truncated file) —
// callers should route that through clampSpotSeconds rather than trust the 0.
// Client-only (creates a <video> and an object URL).
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    let settled = false
    const done = (secs: number) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(secs)
    }
    v.preload = 'metadata'
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0)
    v.onerror = () => done(0)
    // Backstop: some mobile WebViews fire neither event on a file they can't parse,
    // which would otherwise leave the upload button spinning forever.
    setTimeout(() => done(0), 15_000)
    v.src = url
  })
}

export function validateCreativeFile(file: File): string | null {
  if (file.size > MAX_CREATIVE_MB * 1_000_000) {
    return `That file is ${(file.size / 1_000_000).toFixed(0)} MB. Keep it under ${MAX_CREATIVE_MB} MB so it loads fast on the venue's screen.`
  }
  const isVideo = file.type.startsWith('video/')
  const isImage = file.type.startsWith('image/')
  if (!isVideo && !isImage) return 'Upload an image or a video file.'
  if (isVideo && !OK_VIDEO_TYPES.includes(file.type)) {
    return 'Please upload an MP4 (H.264), WebM, or .mov video. Other formats may not play on the TV.'
  }
  return null
}

// Guard: a creative MUST be a file we host in the `creatives` bucket, in the
// uploader's own folder — never an arbitrary external URL. Uploads write to the
// path `<userId>/<uuid>.<ext>`, so the public URL is
// `<SUPABASE_URL>/storage/v1/object/public/creatives/<userId>/…`. Without this
// check an advertiser could get a clean file approved and then swap the file on
// their OWN server, so unreviewed content airs — a bait-and-switch straight past
// ad review. Enforcing our-storage-only means the only way to change what plays
// is to upload a new file, which re-enters review ('pending'). Pure string
// compare, safe to call on the server (NEXT_PUBLIC_SUPABASE_URL is defined both
// places). Pass an empty/whitespace userId and it always fails closed.
export function isOwnCreativeUrl(url: string | null | undefined, userId: string): boolean {
  if (!url || !userId.trim()) return false
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return false
  return url.startsWith(`${supabaseUrl}/storage/v1/object/public/creatives/${userId}/`)
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

// Fit the natural image into the WxH frame, then zoom about center and pan.
// `fit`: 'cover' fills the frame (crops overflow); 'contain' fits the whole image
// inside it (black bars around). Returns the draw rect in frame pixels — used for
// BOTH the CSS preview (as % of the frame) and the canvas export, so they line up.
export function computeDraw(
  nat: { w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
  W: number,
  H: number,
  fit: 'cover' | 'contain' = 'cover'
) {
  const base = fit === 'contain' ? Math.min(W / nat.w, H / nat.h) : Math.max(W / nat.w, H / nat.h)
  const s = base * zoom
  const dw = nat.w * s
  const dh = nat.h * s
  const dx = (W - dw) / 2 + pan.x * W
  const dy = (H - dh) / 2 + pan.y * H
  return { dx, dy, dw, dh }
}

// The transform an editor applies to a creative. `pan` is a FRACTION of the frame
// (so it's resolution-independent), `rotation` is in degrees about center, `fit`
// is the base sizing, `filterStr` the CSS filter string (identical in preview + bake).
export interface CreativeTransform {
  zoom: number
  pan: { x: number; y: number }
  rotation?: number
  fit?: 'cover' | 'contain'
  filterStr?: string
}

// THE shared render routine: black fill, then the filtered/rotated/scaled image.
// Used by BOTH the live editor preview (drawn at frame size) and the exported PNG
// (drawn at 1920x1080) — so what the user frames is exactly what airs. The QR is
// NEVER drawn here (the TV overlays a tracked QR at play time). Client-only (canvas).
// Resolution-independent: fit derives from W/H and pan is fractional, so a 640px
// preview and a 1920px bake produce the identical framing (incl. the black bars).
export function drawCreative(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  t: CreativeTransform,
  W: number,
  H: number
): void {
  const nw = (img as HTMLImageElement).naturalWidth || (img as HTMLVideoElement).videoWidth || (img as HTMLCanvasElement).width
  const nh = (img as HTMLImageElement).naturalHeight || (img as HTMLVideoElement).videoHeight || (img as HTMLCanvasElement).height
  const rotation = t.rotation ?? 0
  const fit = t.fit ?? 'cover'
  // Fit on the ROTATED bounding box so a rotated image still fits inside the frame.
  const box = rotatedBox(nw, nh, rotation)
  const base = fit === 'contain' ? Math.min(W / box.w, H / box.h) : Math.max(W / box.w, H / box.h)
  const s = base * t.zoom
  const cx = W / 2 + t.pan.x * W
  const cy = H / 2 + t.pan.y * H

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.filter = t.filterStr || 'none'
  ctx.translate(cx, cy)
  ctx.rotate(toRad(rotation))
  ctx.drawImage(img, (-nw * s) / 2, (-nh * s) / 2, nw * s, nh * s)
  ctx.restore()
}

// The creative's axis-aligned bounding box within the frame, in [0,1] FRACTIONS.
// Drives the editor's resize handles (they sit on this box) and any CSS overlay.
// Mirrors drawCreative's fit/zoom/pan/rotation math exactly.
export function creativeRect(
  nat: { w: number; h: number },
  t: CreativeTransform
): { x: number; y: number; w: number; h: number } {
  // Fit against the 16:9 frame (EXPORT_W:EXPORT_H) — the fractions are aspect-
  // relative, so this must use the frame's real aspect, not a unit square. Mirrors
  // computeDraw/drawCreative exactly: w/h are the box's pixel size / frame size.
  const box = rotatedBox(nat.w, nat.h, t.rotation ?? 0)
  const fit = t.fit ?? 'cover'
  const base =
    fit === 'contain'
      ? Math.min(EXPORT_W / box.w, EXPORT_H / box.h)
      : Math.max(EXPORT_W / box.w, EXPORT_H / box.h)
  const s = base * t.zoom
  const w = (box.w * s) / EXPORT_W
  const h = (box.h * s) / EXPORT_H
  return { x: (1 - w) / 2 + t.pan.x, y: (1 - h) / 2 + t.pan.y, w, h }
}

// Composite a transformed + filtered photo to a fixed 16:9 1920x1080 PNG via the
// shared drawCreative routine. QR is never baked in. Client-only (uses canvas).
export async function exportImageBlob(src: string, t: CreativeTransform): Promise<Blob> {
  const img = await createImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_W
  canvas.height = EXPORT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available.')
  drawCreative(ctx, img, t, EXPORT_W, EXPORT_H)
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

// Bake a react-easy-crop selection into a SQUARE LOGO_SIZE PNG (the logo editor
// still uses react-easy-crop). Two-stage rotate-then-crop; the output is square and
// the background
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
