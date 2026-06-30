// Shared basemap tiles for every Leaflet map in the app (browse, campaign,
// admin). One source of truth so the look stays consistent and is trivial to
// restyle. CARTO dark_all: a dark, labelled basemap so the map sits inside the
// near-black app theme instead of flashing a bright-white rectangle. Free raster
// tiles, no API key — attribution is required and provided below.
export const MAP_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
export const MAP_TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO'
