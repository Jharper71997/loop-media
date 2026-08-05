// Shared basemap tiles for every Leaflet map in the app (browse, campaign, admin,
// public directory). One source of truth so the look stays consistent and is
// trivial to restyle. Free CARTO raster tiles, no API key — attribution is
// required and provided below.
//
// TWO basemaps, because there are two themes. A dark map inside the bright
// default theme reads as a black hole punched in the page (it was the loudest
// thing on the public directory), and a light map inside the dark theme flashes
// a white rectangle. Pick with `useMapTileUrl()` from
// components/app/useMapTiles.ts rather than importing a constant directly, so
// the basemap follows the theme toggle.

/** CARTO Voyager: light, friendly, full-colour labels. Default/light theme. */
export const MAP_TILE_URL_LIGHT =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'

/** CARTO dark_all: muted dark basemap for the dark theme. */
export const MAP_TILE_URL_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'

/** First-paint fallback — matches the default theme. */
export const MAP_TILE_URL = MAP_TILE_URL_LIGHT

export const MAP_TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO'
