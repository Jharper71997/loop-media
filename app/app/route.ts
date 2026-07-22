// Public download for the Fire TV / Android TV kiosk shell.
//
// On the TV the host opens the "Downloader" app and types  www.loopnetwork.org/app
// After installing, they open "Loop Network" and enter their pairing code.
//
// TYPE THE "www." — Vercel serves the apex as a 308 to www, so a bare
// loopnetwork.org/app costs an extra hop before this route is even reached.
// Downloader also prepends http:// when no scheme is typed, which Vercel 308s to
// https. Those are platform-level redirects we cannot remove from code; using
// www keeps it to that single unavoidable protocol upgrade.
//
// This route STREAMS the APK rather than redirecting to the GitHub release.
// The old redirect was really three hops across three hosts ending in a
// ~950-character signed Azure blob URL that expires in an hour, which hung
// Downloader on "Connecting..." forever. The GitHub release is still the source
// of truth — the `Build TV APK` workflow publishes there exactly as before — we
// just fetch it server-side so the TV makes one plain request to our own domain.
//
// It is a faithful byte-for-byte proxy, including range requests: Downloader
// resumes interrupted transfers with `Range: bytes=N-` and expects a 206 back.
// Advertising Accept-Ranges while answering 200 to a Range request is what makes
// a resuming client stall, so we forward the header upstream and pass the real
// status through instead of inventing one.
//
// NOTE: this 502s until the first successful `Build TV APK` workflow run
// creates the `tv-app-latest` release.
const APK_URL =
  'https://github.com/Jharper71997/loop-media/releases/download/tv-app-latest/loop-network-tv.apk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Headers a TV downloader actually keys off. Content-Disposition is not
// cosmetic: without it Fire OS saves the file as extensionless "app" and never
// offers to install it.
function apkHeaders(upstream: Response) {
  const headers = new Headers({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': 'attachment; filename="loop-network-tv.apk"',
    'Cache-Control': 'public, max-age=300',
  })
  // Pass length/range straight through — Downloader draws its progress bar from
  // the total and stalls on a chunked response with no length.
  for (const h of ['content-length', 'content-range', 'accept-ranges'] as const) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  return headers
}

async function fetchApk(method: 'GET' | 'HEAD', req: Request) {
  const range = req.headers.get('range')
  return fetch(APK_URL, {
    method,
    redirect: 'follow',
    cache: 'no-store',
    headers: range ? { Range: range } : undefined,
  })
}

export async function GET(req: Request) {
  const upstream = await fetchApk('GET', req)
  if (!upstream.ok || !upstream.body) {
    return new Response('TV app is not available yet.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  // 200 for a full download, 206 when the TV is resuming.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: apkHeaders(upstream),
  })
}

// Downloader probes with HEAD before it commits to the download.
export async function HEAD(req: Request) {
  const upstream = await fetchApk('HEAD', req)
  if (!upstream.ok) return new Response(null, { status: 502 })
  return new Response(null, { status: upstream.status, headers: apkHeaders(upstream) })
}
