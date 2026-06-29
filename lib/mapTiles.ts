// Shared basemap tiles for every Leaflet map in the app (browse, campaign,
// admin). One source of truth so the look stays consistent and is trivial to
// restyle. CARTO Voyager: clean, modern, readable. Free raster tiles, no API
// key — attribution is required and provided below.
export const MAP_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
export const MAP_TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO'
