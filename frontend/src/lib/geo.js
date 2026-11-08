/**
 * Web Mercator helpers.
 *
 * Terrain tiles and the Leaflet map both live in Web Mercator (EPSG:3857), so all
 * raster work is done in "global pixel" space at a given zoom: x grows east,
 * y grows south, and one tile is 256 × 256 pixels. Working in this space keeps the
 * DEM, the dam line and the flood overlay exactly aligned with the basemap.
 */

export const TILE_SIZE = 256
const EARTH_RADIUS = 6378137 // WGS84 semi-major axis, the radius Web Mercator uses

const worldSize = z => TILE_SIZE * 2 ** z

export function lonLatToGlobalPx(lon, lat, z) {
  const s = worldSize(z)
  const sin = Math.sin((lat * Math.PI) / 180)
  return [
    ((lon + 180) / 360) * s,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s,
  ]
}

export function globalPxToLonLat(x, y, z) {
  const s = worldSize(z)
  const n = Math.PI - (2 * Math.PI * y) / s
  return [(x / s) * 360 - 180, (180 / Math.PI) * Math.atan(Math.sinh(n))]
}

/** Ground size (m) of one pixel at global pixel row y. Mercator is conformal, so pixels are square. */
export function metersPerPixel(globalY, z) {
  const [, lat] = globalPxToLonLat(0, globalY, z)
  return (2 * Math.PI * EARTH_RADIUS * Math.cos((lat * Math.PI) / 180)) / worldSize(z)
}

/** Great-circle distance in metres between two [lon, lat] points. */
export function haversine([lon1, lat1], [lon2, lat2]) {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a))
}

export function polylineLength(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i])
  return total
}
