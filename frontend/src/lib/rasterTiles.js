/**
 * Resample lon/lat (EPSG:4326-style) elevation rasters into Web Mercator tiles.
 *
 * A "piece" is a regular lon/lat raster:
 *   { data: Float32Array, width, height, west, north, dx, dy }
 * where pixel (row i, col j) covers lon [west + j*dx, west + (j+1)*dx] and
 * lat [north - (i+1)*dy, north - i*dy]. NaN = no data.
 *
 * Sources supply pieces per square "block" of `blockDeg` degrees. Each block
 * is fetched once and reused by every tile that touches it.
 */

import { TILE_SIZE, globalPxToLonLat } from './geo.js'
import { cached } from './terrain.js'

/** Bilinear sample at lon/lat, falling back to nearest when a neighbour is missing. */
export function samplePiece(p, lon, lat) {
  const fx = (lon - p.west) / p.dx - 0.5
  const fy = (p.north - lat) / p.dy - 0.5
  if (fx < -0.5 || fy < -0.5 || fx > p.width - 0.5 || fy > p.height - 0.5) return undefined
  const x0 = Math.max(0, Math.min(p.width - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(p.height - 1, Math.floor(fy)))
  const x1 = Math.min(p.width - 1, x0 + 1)
  const y1 = Math.min(p.height - 1, y0 + 1)
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0))
  const d = p.data, w = p.width
  const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1]
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(e)) {
    return d[Math.round(Math.max(0, Math.min(p.height - 1, fy))) * w + Math.round(Math.max(0, Math.min(w - 1, fx)))]
  }
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty
}

/**
 * @param readBlock (west, south, east, north, z) => Promise<piece[]>  (pieces may extend past the block)
 * @param blockDeg  block size in degrees
 * @param blockZoom (z) => key part, so blocks can depend on the target resolution
 */
export function rasterTileLoader({ readBlock, blockDeg, blockZoom = () => 0, maxConcurrent = 4, retries = 2 }) {
  const blockCache = new Map()

  // Limit parallel block reads: too many in-flight range requests make browsers drop them
  let active = 0
  const waiting = []
  const limited = async fn => {
    if (active >= maxConcurrent) await new Promise(res => waiting.push(res))
    active++
    try { return await fn() } finally {
      active--
      waiting.shift()?.()
    }
  }
  const withRetry = async fn => {
    for (let attempt = 0; ; attempt++) {
      try { return await fn() } catch (e) {
        if (attempt >= retries || e?.permanent) throw e
        await new Promise(res => setTimeout(res, 800 * (attempt + 1)))
      }
    }
  }
  const getBlock = (bx, by, z) => {
    const key = `${blockZoom(z)}/${bx}/${by}`
    if (!blockCache.has(key)) {
      const west = bx * blockDeg, south = by * blockDeg
      const p = withRetry(() => limited(() => readBlock(west, south, west + blockDeg, south + blockDeg, z))).catch(err => {
        blockCache.delete(key)
        throw err
      })
      blockCache.set(key, p)
    }
    return blockCache.get(key)
  }

  return cached(async (z, x, y) => {
    const [west, north] = globalPxToLonLat(x * TILE_SIZE, y * TILE_SIZE, z)
    const [east, south] = globalPxToLonLat((x + 1) * TILE_SIZE, (y + 1) * TILE_SIZE, z)
    const bx0 = Math.floor(west / blockDeg), bx1 = Math.floor((east - 1e-12) / blockDeg)
    const by0 = Math.floor(south / blockDeg), by1 = Math.floor((north - 1e-12) / blockDeg)

    const blocks = new Map()
    const jobs = []
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        jobs.push(getBlock(bx, by, z).then(pieces => blocks.set(`${bx}/${by}`, pieces)))
      }
    }
    await Promise.all(jobs)

    const out = new Float32Array(TILE_SIZE * TILE_SIZE)
    const lons = new Float64Array(TILE_SIZE)
    for (let c = 0; c < TILE_SIZE; c++) lons[c] = globalPxToLonLat(x * TILE_SIZE + c + 0.5, 0, z)[0]

    for (let r = 0; r < TILE_SIZE; r++) {
      const lat = globalPxToLonLat(0, y * TILE_SIZE + r + 0.5, z)[1]
      const by = Math.floor(lat / blockDeg)
      for (let c = 0; c < TILE_SIZE; c++) {
        const lon = lons[c]
        const pieces = blocks.get(`${Math.floor(lon / blockDeg)}/${by}`)
        let v = NaN
        if (pieces) {
          for (const p of pieces) {
            const s = samplePiece(p, lon, lat)
            if (s !== undefined && !Number.isNaN(s)) { v = s; break }
          }
        }
        out[r * TILE_SIZE + c] = v
      }
    }
    return out
  })
}

/**
 * Read a lon/lat window from an opened GeoTIFF image as a piece, with a one-pixel
 * margin so bilinear sampling works across block edges. For an overview level,
 * pass the full-resolution image as `ref` (overviews carry no georeference).
 */
export async function readGeoTiffWindow(image, west, south, east, north, { ref = image, signal } = {}) {
  const geo = imageGeoref(image, ref)
  const j0 = Math.max(0, Math.floor((west - geo.west) / geo.dx) - 1)
  const j1 = Math.min(geo.width, Math.ceil((east - geo.west) / geo.dx) + 1)
  const i0 = Math.max(0, Math.floor((geo.north - north) / geo.dy) - 1)
  const i1 = Math.min(geo.height, Math.ceil((geo.north - south) / geo.dy) + 1)
  if (j1 <= j0 || i1 <= i0) return null

  const raster = await image.readRasters({ window: [j0, i0, j1, i1], samples: [0], interleave: true, signal })
  const nodata = ref.getGDALNoData()
  const data = new Float32Array(raster.length)
  for (let k = 0; k < raster.length; k++) {
    const v = raster[k]
    data[k] = v === nodata || v < -1000 || v > 9000 || Number.isNaN(v) ? NaN : v
  }
  return {
    data,
    width: j1 - j0,
    height: i1 - i0,
    west: geo.west + j0 * geo.dx,
    north: geo.north - i0 * geo.dy,
    dx: geo.dx,
    dy: geo.dy,
  }
}

/** Corner-based georeference of a GeoTIFF image (handles PixelIsPoint rasters). */
export function imageGeoref(image, ref = image) {
  const [ox, oy] = ref.getOrigin()
  const [rx, ry] = image.getResolution(ref)
  const dx = Math.abs(rx), dy = Math.abs(ry)
  // PixelIsPoint: the tiepoint is the centre of the first pixel, not its corner
  const isPoint = ref.getGeoKeys?.()?.GTRasterTypeGeoKey === 2
  const [refDx, refDy] = ref.getResolution().map(Math.abs)
  return {
    west: isPoint ? ox - refDx / 2 : ox,
    north: isPoint ? oy + refDy / 2 : oy,
    dx,
    dy,
    width: image.getWidth(),
    height: image.getHeight(),
  }
}
