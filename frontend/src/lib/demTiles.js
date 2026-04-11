/**
 * Fetches and mosaics AWS Terrain Tiles (Terrarium format) for a bounding box.
 * No API key required — public dataset with CORS headers.
 *
 * Terrarium elevation encoding: elevation_m = R*256 + G + B/256 - 32768
 */

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const TILE_SIZE = 256

function lonToTileX(lon, zoom) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, zoom))
}

function latToTileY(lat, zoom) {
  const latRad = lat * Math.PI / 180
  const n = Math.pow(2, zoom)
  return Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
}

function tileNWCorner(tx, ty, zoom) {
  const n = Math.pow(2, zoom)
  const lon = tx / n * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n)))
  return [lon, latRad * 180 / Math.PI]
}

function chooseZoom(west, south, east, north) {
  const centerLat = (north + south) / 2
  const widthKm = (east - west) * 111.32 * Math.cos(centerLat * Math.PI / 180)
  if (widthKm < 8)  return 14   // ~10 m/px
  if (widthKm < 25) return 13   // ~20 m/px
  if (widthKm < 80) return 12   // ~40 m/px
  return 11                      // ~80 m/px
}

async function fetchTileElevations(tx, ty, zoom) {
  const url = TILE_URL.replace('{z}', zoom).replace('{x}', tx).replace('{y}', ty)

  const img = new Image()
  img.crossOrigin = 'anonymous'

  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error(`Failed to load tile ${tx}/${ty}/${zoom}`))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)

  const px = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data
  const elev = new Float32Array(TILE_SIZE * TILE_SIZE)
  for (let i = 0; i < elev.length; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]
    const e = r * 256 + g + b / 256 - 32768
    // Treat deep ocean / no-data as NaN
    elev[i] = e < -200 ? NaN : e
  }
  return elev
}

/**
 * Fetch a DEM for the given bounding box.
 *
 * @returns {Promise<DEM>} where DEM = {
 *   data      : Float32Array  elevation in m ASL (row-major, NaN = no-data)
 *   width     : number
 *   height    : number
 *   bounds    : { west, east, north, south }  — actual mosaic bounds
 *   pixelWidthDeg  : degrees per pixel (longitude)
 *   pixelHeightDeg : degrees per pixel (latitude)
 * }
 */
export async function fetchDEM(west, south, east, north) {
  const zoom = chooseZoom(west, south, east, north)

  const txMin = lonToTileX(west, zoom)
  const txMax = lonToTileX(east, zoom)
  const tyMin = latToTileY(north, zoom)   // N → smaller y index
  const tyMax = latToTileY(south, zoom)   // S → larger  y index

  const nCols = txMax - txMin + 1
  const nRows = tyMax - tyMin + 1

  // Fetch all tiles in parallel
  const fetches = []
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      fetches.push({ tx, ty, promise: fetchTileElevations(tx, ty, zoom) })
    }
  }

  const mosaicW = nCols * TILE_SIZE
  const mosaicH = nRows * TILE_SIZE
  const mosaic  = new Float32Array(mosaicW * mosaicH).fill(NaN)

  await Promise.all(fetches.map(async ({ tx, ty, promise }) => {
    const tile = await promise
    const c0 = (tx - txMin) * TILE_SIZE
    const r0 = (ty - tyMin) * TILE_SIZE
    for (let r = 0; r < TILE_SIZE; r++) {
      const srcOff = r * TILE_SIZE
      const dstOff = (r0 + r) * mosaicW + c0
      mosaic.set(tile.subarray(srcOff, srcOff + TILE_SIZE), dstOff)
    }
  }))

  const [mosaicWest, mosaicNorth] = tileNWCorner(txMin, tyMin, zoom)
  const [mosaicEast, mosaicSouth] = tileNWCorner(txMax + 1, tyMax + 1, zoom)

  return {
    data:   mosaic,
    width:  mosaicW,
    height: mosaicH,
    bounds: { west: mosaicWest, east: mosaicEast, north: mosaicNorth, south: mosaicSouth },
    pixelWidthDeg:  (mosaicEast  - mosaicWest)  / mosaicW,
    pixelHeightDeg: (mosaicNorth - mosaicSouth) / mosaicH,
  }
}

/** Return { min, max } of valid (non-NaN) elevations */
export function elevationRange(dem) {
  let min = Infinity, max = -Infinity
  for (let i = 0; i < dem.data.length; i++) {
    const v = dem.data[i]
    if (isNaN(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 100 }
}

/** Sample elevation at a given lon/lat from the DEM (nearest-neighbour) */
export function sampleElevation(dem, lon, lat) {
  const { data, width, height, bounds, pixelWidthDeg, pixelHeightDeg } = dem
  const col = Math.round((lon - bounds.west)  / pixelWidthDeg  - 0.5)
  const row = Math.round((bounds.north - lat) / pixelHeightDeg - 0.5)
  const c = Math.max(0, Math.min(width  - 1, col))
  const r = Math.max(0, Math.min(height - 1, row))
  return data[r * width + c]
}
