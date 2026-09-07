// Shared basemap tiles for every Leaflet map in the app (browse, campaign, admin,
// public directory). One source of truth so the look stays consistent and is
// trivial to restyle.
//
// TWO basemaps, because there are two themes. A dark map inside the bright
// default theme reads as a black hole punched in the page (it was the loudest
// thing on the public directory), and a light map inside the dark theme flashes
// a white rectangle. Pick with `useMapTiles()` from
// components/app/useMapTiles.ts rather than importing a constant directly, so
// the basemap follows the theme toggle.
//
// TWO PROVIDERS, because CARTO changed the deal. Their raster basemaps used to be
// keyless; they now stamp a diagonal "API KEY REQUIRED — carto.com/basemaps/apikey"
// watermark across every tile of an unkeyed request. The tiles still return HTTP
// 200 with a valid PNG, so nothing errors and no log shows it — the watermark is
// painted INTO the image, and the only way to catch it is to look at a tile.
//
//   * NEXT_PUBLIC_CARTO_API_KEY set  -> CARTO Voyager / dark_all, the original look.
//     Free key at carto.com/basemaps/apikey (5M tiles/month, issued instantly).
//   * not set                        -> Esri, which needs no key or account.
//
// Attribution travels WITH the tiles here rather than being a lone constant: each
// provider requires its own, and getting that wrong is a licensing problem, not a
// cosmetic one.

export interface Basemap {
  url: string
  attribution: string
}

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY

const CARTO_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO'
const ESRI_ATTRIBUTION =
  'Tiles &copy; Esri — Esri, HERE, Garmin, USGS, NGA, &copy; OpenStreetMap contributors'

// CARTO Voyager: light, friendly, full-colour labels.
const CARTO_LIGHT: Basemap = {
  url: `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_KEY}`,
  attribution: CARTO_ATTRIBUTION,
}

// CARTO dark_all: muted dark basemap for the dark theme.
const CARTO_DARK: Basemap = {
  url: `https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=${CARTO_KEY}`,
  attribution: CARTO_ATTRIBUTION,
}

// Esri World Street Map: keyless, labelled, and close enough to Voyager that the
// venue pins still read as the loudest thing on the map.
const ESRI_LIGHT: Basemap = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  attribution: ESRI_ATTRIBUTION,
}

// Esri Dark Gray Canvas: keyless dark. Note it carries no place labels of its own
// (Esri splits those into a separate reference layer), so the dark theme without a
// CARTO key is a quieter, label-light map. One more reason to set the key.
const ESRI_DARK: Basemap = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  attribution: ESRI_ATTRIBUTION,
}

export const BASEMAP_LIGHT: Basemap = CARTO_KEY ? CARTO_LIGHT : ESRI_LIGHT
export const BASEMAP_DARK: Basemap = CARTO_KEY ? CARTO_DARK : ESRI_DARK

/** First-paint fallback — matches the default (light) theme. */
export const BASEMAP_DEFAULT = BASEMAP_LIGHT
