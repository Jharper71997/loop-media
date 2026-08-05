'use client'

import { useEffect, useState } from 'react'
import { MAP_TILE_URL_DARK, MAP_TILE_URL_LIGHT } from '@/lib/mapTiles'

// Which basemap to draw, following the live theme. The theme is a class the
// server put on <html> (lib/theme.ts) and the toggle swaps in place without a
// re-render, so we watch the class list instead of reading it once.
//
// Starts on the light URL to match the default theme and the server's first
// paint; a dark-theme visitor swaps on mount, one tile fetch later.
export function useMapTileUrl(): string {
  const [url, setUrl] = useState(MAP_TILE_URL_LIGHT)

  useEffect(() => {
    const root = document.documentElement
    const sync = () =>
      setUrl(root.classList.contains('dark') ? MAP_TILE_URL_DARK : MAP_TILE_URL_LIGHT)
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return url
}
