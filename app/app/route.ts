import { NextResponse } from 'next/server'

// Public download for the Fire TV / Android TV kiosk shell.
//
// On the TV the host opens the "Downloader" app and types  loopnetwork.org/app
// This 302-redirects to the signed APK published by the tv-app GitHub Actions
// build. After installing, they open "Loop Network" and enter their pairing
// code — no other setup.
//
// NOTE: the target 404s until the first successful `Build TV APK` workflow run
// creates the `tv-app-latest` release.
const APK_URL =
  'https://github.com/Jharper71997/loop-media/releases/download/tv-app-latest/loop-network-tv.apk'

export function GET() {
  return NextResponse.redirect(APK_URL, 302)
}
