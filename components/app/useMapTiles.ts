'use client'

import { useEffect, useState } from 'react'
import { BASEMAP_DARK, BASEMAP_LIGHT, type Basemap } from '@/lib/mapTiles'

// Which basemap to draw, following the live theme. The theme is a class the
// server put on <html> (lib/theme.ts) and the toggle swaps in place without a
// re-render, so we watch the class list instead of reading it once.
//
// Returns the URL and its attribution together: the two basemaps can come from
// different providers (see lib/mapTiles.ts), and a tile layer showing one
// provider's map under another's credit is a licensing problem.
//
// Starts on the light basemap to match the default theme and the server's first
// paint; a dark-theme visitor swaps on mount, one tile fetch later.
export function useMapTiles(): Basemap {
  const [basemap, setBasemap] = useState<Basemap>(BASEMAP_LIGHT)

  useEffect(() => {
    const root = document.documentElement
    const sync = () =>
      setBasemap(root.classList.contains('dark') ? BASEMAP_DARK : BASEMAP_LIGHT)
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return basemap
}
