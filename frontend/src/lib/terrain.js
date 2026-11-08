/**
 * Terrain tiles: AWS Open Data "Terrarium" elevation PNGs (no API key, CORS-enabled).
 * Encoding: elevation_m = R * 256 + G + B / 256 - 32768
 * Sources: SRTM 30 m over most land, finer national datasets in some countries.
 */

import { TILE_SIZE } from './geo.js'

export const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

/** Decode Terrarium RGBA pixels into elevations. */
export function decodeTerrarium(rgba) {
  const out = new Float32Array(TILE_SIZE * TILE_SIZE)
  for (let i = 0; i < out.length; i++) {
    const p = i * 4
    out[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768
  }
  return out
}

/** Browser decoder: fetch PNG → raw pixels (no colour management or premultiplication). */
async function fetchTileBrowser(url) {
  let resp
  for (let attempt = 0; ; attempt++) {
    try {
      resp = await fetch(url)
      if (resp.ok || resp.status === 404 || attempt >= 2) break
    } catch (e) {
      if (attempt >= 2) throw e
    }
  }
  if (resp.status === 404) return new Float32Array(TILE_SIZE * TILE_SIZE).fill(NaN)
  if (!resp.ok) throw new Error(`Terrain tile request failed (${resp.status})`)

  const bitmap = await createImageBitmap(await resp.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
      : Object.assign(document.createElement('canvas'), { width: TILE_SIZE, height: TILE_SIZE })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return decodeTerrarium(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data)
}

/**
 * Create a caching tile loader: (z, x, y) => Promise<Float32Array(256*256)>.
 * `fetchTile(url)` can be swapped out (e.g. in Node scripts and tests).
 */
export function createTileLoader(fetchTile = fetchTileBrowser) {
  const cache = new Map()
  return (z, x, y) => {
    const key = `${z}/${x}/${y}`
    if (!cache.has(key)) {
      const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y)
      const p = fetchTile(url).catch(err => {
        cache.delete(key) // allow retry on the next run
        throw err
      })
      cache.set(key, p)
    }
    return cache.get(key)
  }
}
