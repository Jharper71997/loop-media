import type { Metadata, Viewport } from 'next'
import { TvPlayer } from './TvPlayer'

export const metadata: Metadata = {
  title: 'Loop Network — Display',
}

// Keep TV browsers from scaling the kiosk view.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

// Fullscreen kiosk display. Public route — pairing is by device code, not login.
export default function TvDisplayPage() {
  return <TvPlayer />
}
