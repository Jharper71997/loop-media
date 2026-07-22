// Alias so the download URL itself ends in ".apk":  loopnetwork.org/app.apk
//
// /app is the address hosts are told to type, and it serves the same bytes. But
// some Downloader builds decide whether a file is installable from the URL's
// extension rather than the Content-Type, so this gives us a URL to fall back on
// when a TV refuses to open the download. Same handler, no second copy of the logic.
export { GET, HEAD } from '../app/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
