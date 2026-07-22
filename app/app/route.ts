// Public download for the Fire TV / Android TV kiosk shell.
//
// On the TV the host opens the "Downloader" app and types  loopnetwork.org/app
// After installing, they open "Loop Network" and enter their pairing code — no
// other setup.
//
// This used to 302 straight to the GitHub release asset, which hung Downloader
// on "Connecting..." forever. The reason: that one redirect is really three
// hops across three hosts, and the last one is a ~950-character signed Azure
// blob URL (github.com -> release-assets.githubusercontent.com -> blob store).
// Downloader's built-in HTTP client does not survive that chain.
//
// So we stream the bytes ourselves instead. The TV now sees a single request to
// loopnetwork.org that answers 200 with the APK — no redirects, no signed URL,
// no expiry. The GitHub release stays the source of truth, so the `Build TV APK`
// workflow still publishes updates the same way; we just fetch it server-side.
//
// NOTE: this 502s until the first successful `Build TV APK` workflow run
// creates the `tv-app-latest` release.
const APK_URL =
  'https://github.com/Jharper71997/loop-media/releases/download/tv-app-latest/loop-network-tv.apk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function apkHeaders(contentLength: string | null) {
  const headers = new Headers({
    'Content-Type': 'application/vnd.android.package-archive',
    // Downloader names the saved file from this. Without it the file lands as
    // "app" with no extension and Fire OS never offers to install it.
    'Content-Disposition': 'attachment; filename="loop-network-tv.apk"',
    // Downloader draws its progress bar from the length, and some builds stall
    // on a chunked response with no total. Always pass it through when we have it.
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=300',
  })
  if (contentLength) headers.set('Content-Length', contentLength)
  return headers
}

export async function GET() {
  const upstream = await fetch(APK_URL, { redirect: 'follow', cache: 'no-store' })
  if (!upstream.ok || !upstream.body) {
    return new Response('TV app is not available yet.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: apkHeaders(upstream.headers.get('content-length')),
  })
}

// Downloader probes with HEAD before it commits to the download.
export async function HEAD() {
  const upstream = await fetch(APK_URL, { method: 'HEAD', redirect: 'follow', cache: 'no-store' })
  if (!upstream.ok) return new Response(null, { status: 502 })
  return new Response(null, {
    status: 200,
    headers: apkHeaders(upstream.headers.get('content-length')),
  })
}
