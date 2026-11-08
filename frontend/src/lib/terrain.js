/**
 * Shared terrain plumbing: every dataset is exposed to the engine as a
 * tile loader (z, x, y) => Promise<Float32Array(256 * 256)> of elevations in
 * metres for a standard Web Mercator tile (NaN = no data).
 */

import { TILE_SIZE } from './geo.js'

export class TerrainError extends Error {
  constructor(message, { permanent = false } = {}) {
    super(message)
    this.permanent = permanent
  }
}

/** Wrap a tile loader with a promise cache; failed tiles are retried next time. */
export function cached(load) {
  const cache = new Map()
  return (z, x, y) => {
    const key = `${z}/${x}/${y}`
    if (!cache.has(key)) {
      cache.set(key, load(z, x, y).catch(err => {
        cache.delete(key)
        throw err
      }))
    }
    return cache.get(key)
  }
}

/** fetch with two retries on network errors and 5xx responses. */
export async function fetchWithRetry(url, init) {
  for (let attempt = 0; ; attempt++) {
    try {
      const resp = await fetch(url, init)
      if (resp.status < 500 || attempt >= 2) return resp
    } catch (e) {
      if (attempt >= 2) throw new TerrainError(`Network error while loading terrain: ${e.message}`)
    }
  }
}

/** Turn an HTTP error into a readable message, calling out rejected API keys. */
export async function httpError(resp, provider) {
  if (resp.status === 401 || resp.status === 403) {
    return new TerrainError(`${provider} rejected the request (HTTP ${resp.status}). Check that the API key is correct and active.`, { permanent: true })
  }
  if (resp.status === 429) {
    return new TerrainError(`${provider} rate limit reached (HTTP 429). Wait a while or use another dataset.`, { permanent: true })
  }
  let detail = ''
  try { detail = (await resp.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) } catch { /* ignore */ }
  return new TerrainError(`${provider} request failed (HTTP ${resp.status})${detail ? `: ${detail}` : ''}`)
}

/** Raw RGBA pixels of a PNG/WebP, without colour management or premultiplication. */
async function decodeImage(blob) {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const { width, height } = bitmap
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height }
}

// ---- RGB elevation encodings ----

/** Terrarium: R * 256 + G + B / 256 - 32768 */
export function decodeTerrarium(rgba, n = TILE_SIZE * TILE_SIZE) {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    out[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768
  }
  return out
}

/** Mapbox / MapTiler Terrain-RGB: -10000 + (R * 65536 + G * 256 + B) * 0.1 */
export function decodeMapboxRgb(rgba, n = TILE_SIZE * TILE_SIZE) {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    out[i] = rgba[p + 3] === 0 ? NaN : -10000 + (rgba[p] * 65536 + rgba[p + 1] * 256 + rgba[p + 2]) * 0.1
  }
  return out
}

/** Box-resample a square elevation tile (e.g. 512 px) to 256 × 256, ignoring NaN. */
export function toTileSize(data, size) {
  if (size === TILE_SIZE) return data
  const out = new Float32Array(TILE_SIZE * TILE_SIZE)
  const k = size / TILE_SIZE
  for (let r = 0; r < TILE_SIZE; r++) {
    for (let c = 0; c < TILE_SIZE; c++) {
      let sum = 0, n = 0
      const r0 = Math.floor(r * k), r1 = Math.max(r0 + 1, Math.floor((r + 1) * k))
      const c0 = Math.floor(c * k), c1 = Math.max(c0 + 1, Math.floor((c + 1) * k))
      for (let rr = r0; rr < r1; rr++) {
        for (let cc = c0; cc < c1; cc++) {
          const v = data[rr * size + cc]
          if (!Number.isNaN(v)) { sum += v; n++ }
        }
      }
      out[r * TILE_SIZE + c] = n ? sum / n : NaN
    }
  }
  return out
}

/**
 * Loader for an XYZ tileset of RGB-encoded elevation images.
 * @param urlFor  (z, x, y) => url
 * @param decode  decodeTerrarium | decodeMapboxRgb
 * @param maxZoom deepest zoom the service offers; deeper requests are upsampled
 */
export function rgbTileLoader({ urlFor, decode, provider, maxZoom = 15, fetchPixels }) {
  const getPixels = fetchPixels || (async url => {
    const resp = await fetchWithRetry(url)
    if (resp.status === 404) return null
    if (!resp.ok) throw await httpError(resp, provider)
    return decodeImage(await resp.blob())
  })

  const loadNative = cached(async (z, x, y) => {
    const img = await getPixels(urlFor(z, x, y))
    if (!img) return new Float32Array(TILE_SIZE * TILE_SIZE).fill(NaN)
    if (img.width !== img.height) throw new TerrainError(`${provider} returned a non-square tile`)
    return toTileSize(decode(img.rgba, img.width * img.height), img.width)
  })

  return (z, x, y) => {
    if (z <= maxZoom) return loadNative(z, x, y)
    // Upsample from the deepest available zoom (nearest neighbour)
    const k = 2 ** (z - maxZoom)
    return loadNative(maxZoom, Math.floor(x / k), Math.floor(y / k)).then(parent => {
      const out = new Float32Array(TILE_SIZE * TILE_SIZE)
      const ox = (x % k) * (TILE_SIZE / k), oy = (y % k) * (TILE_SIZE / k)
      for (let r = 0; r < TILE_SIZE; r++) {
        for (let c = 0; c < TILE_SIZE; c++) {
          out[r * TILE_SIZE + c] = parent[Math.floor(oy + r / k) * TILE_SIZE + Math.floor(ox + c / k)]
        }
      }
      return out
    })
  }
}
