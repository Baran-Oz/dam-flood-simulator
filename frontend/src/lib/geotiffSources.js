/**
 * GeoTIFF-backed terrain sources:
 *  - Microsoft Planetary Computer: public cloud-optimised GeoTIFFs (1° × 1° files),
 *    found through its STAC catalogue and read with free short-lived SAS tokens.
 *  - OpenTopography Global DEM API: returns a GeoTIFF for a bounding box (API key).
 */

import { fromUrl, fromArrayBuffer } from 'geotiff'
import { TILE_SIZE } from './geo.js'
import { TerrainError, fetchWithRetry, httpError } from './terrain.js'
import { rasterTileLoader, readGeoTiffWindow, imageGeoref } from './rasterTiles.js'

const PC = 'https://planetarycomputer.microsoft.com/api'

/** Lon/lat degrees per Web Mercator pixel at zoom z. */
const degPerPx = z => 360 / (TILE_SIZE * 2 ** z)

/**
 * @param collection  STAC collection id, e.g. 'cop-dem-glo-30'
 * @param asset       asset key holding the GeoTIFF
 * @param gsd         keep only items with this ground sample distance (3DEP has 10 and 30 m)
 */
export function planetaryLoader({ collection, asset = 'data', gsd }) {
  const provider = 'Microsoft Planetary Computer'
  let token = null // { value, expires, promise }

  async function getToken() {
    if (token && Date.now() < token.expires - 5 * 60e3) return token.promise
    const promise = (async () => {
      const resp = await fetchWithRetry(`${PC}/sas/v1/token/${collection}`)
      if (!resp.ok) throw await httpError(resp, provider)
      const j = await resp.json()
      return j.token
    })()
    token = { promise, expires: Date.now() + 45 * 60e3 }
    promise.catch(() => { token = null })
    return promise
  }

  // Items per 1° cell
  const cells = new Map()
  function itemsForCell(cx, cy) {
    const key = `${cx}/${cy}`
    if (!cells.has(key)) {
      const bbox = [cx + 0.001, cy + 0.001, cx + 0.999, cy + 0.999].join(',')
      const p = (async () => {
        const resp = await fetchWithRetry(`${PC}/stac/v1/search?collections=${collection}&bbox=${bbox}&limit=20`)
        if (!resp.ok) throw await httpError(resp, provider)
        const j = await resp.json()
        return j.features
          .filter(f => gsd == null || f.properties.gsd === gsd)
          .map(f => f.assets[asset]?.href)
          .filter(Boolean)
      })()
      p.catch(() => cells.delete(key))
      cells.set(key, p)
    }
    return cells.get(key)
  }

  // Opened files (with overview levels), keyed by href
  const files = new Map()
  function openFile(href) {
    if (!files.has(href)) {
      const p = (async () => {
        const sas = await getToken()
        // 256 KB blocks: far fewer requests than the 64 KB default
        const tiff = await fromUrl(`${href}?${sas}`, { blockSize: 256 * 1024, cacheSize: 160 })
        const main = await tiff.getImage(0)
        const levels = [{ image: main, dx: imageGeoref(main).dx }]
        const count = await tiff.getImageCount()
        for (let i = 1; i < count; i++) {
          const image = await tiff.getImage(i)
          // Skip mask IFDs, keep reduced-resolution elevation levels
          if (image.getSamplesPerPixel() !== main.getSamplesPerPixel()) continue
          levels.push({ image, dx: imageGeoref(image, main).dx })
        }
        levels.sort((a, b) => a.dx - b.dx)
        return { main, levels }
      })()
      p.catch(() => files.delete(href))
      files.set(href, p)
    }
    return files.get(href)
  }

  async function readBlock(west, south, east, north, z) {
    const hrefs = await itemsForCell(Math.floor(west), Math.floor(south))
    const target = degPerPx(z)
    const pieces = []
    for (const href of hrefs) {
      try {
        const { main, levels } = await openFile(href)
        // Coarsest level within 1.5× of the analysis grid spacing (bilinear covers the rest)
        let level = levels[0]
        for (const l of levels) if (l.dx <= target * 1.5) level = l
        const piece = await readGeoTiffWindow(level.image, west, south, east, north, { ref: main })
        if (piece) pieces.push(piece)
      } catch (e) {
        if (e instanceof TerrainError) throw e
        throw new TerrainError(`${provider}: could not read ${collection} (${e.message})`)
      }
    }
    return pieces
  }

  return rasterTileLoader({ readBlock, blockDeg: 0.25, blockZoom: z => z })
}

/** OpenTopography Global DEM API, fetched in 0.5° blocks to stay within request limits. */
export function openTopographyLoader({ demtype, apiKey }) {
  const provider = 'OpenTopography'
  async function readBlock(west, south, east, north) {
    const url =
      'https://portal.opentopography.org/API/globaldem' +
      `?demtype=${encodeURIComponent(demtype)}&south=${south}&north=${north}&west=${west}&east=${east}` +
      `&outputFormat=GTiff&API_Key=${encodeURIComponent(apiKey)}`
    const resp = await fetchWithRetry(url)
    if (!resp.ok) throw await httpError(resp, provider)
    const buf = await resp.arrayBuffer()
    let image
    try {
      image = await (await fromArrayBuffer(buf)).getImage(0)
    } catch {
      const text = new TextDecoder().decode(buf.slice(0, 300)).replace(/<[^>]+>/g, ' ').trim()
      // Out-of-coverage requests return a message instead of a GeoTIFF
      if (/no data|outside|coverage/i.test(text)) return []
      throw new TerrainError(`${provider} returned an unexpected response: ${text.slice(0, 160)}`)
    }
    const piece = await readGeoTiffWindow(image, west, south, east, north)
    return piece ? [piece] : []
  }
  return rasterTileLoader({ readBlock, blockDeg: 0.5 })
}
