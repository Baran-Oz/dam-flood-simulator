import { describe, it, expect } from 'vitest'
import { decodeMapboxRgb, decodeTerrarium, toTileSize, rgbTileLoader } from './terrain.js'
import { rasterTileLoader, samplePiece, imageGeoref } from './rasterTiles.js'
import { SOURCES, KEY_PROVIDERS, sourceById } from './sources.js'
import { TILE_SIZE, lonLatToGlobalPx } from './geo.js'

const px = (...rgba) => Uint8ClampedArray.from(rgba)

describe('RGB elevation encodings', () => {
  it('decodes Terrarium', () => {
    // 1000 m = 33768 = 131 * 256 + 232
    expect(decodeTerrarium(px(131, 232, 0, 255), 1)[0]).toBe(1000)
  })

  it('decodes Mapbox / MapTiler Terrain-RGB, and transparent pixels as no data', () => {
    // 1000 m → (1000 + 10000) * 10 = 110000 = 1 * 65536 + 173 * 256 + 176
    expect(decodeMapboxRgb(px(1, 173, 176, 255), 1)[0]).toBeCloseTo(1000, 5)
    expect(decodeMapboxRgb(px(1, 173, 176, 0), 1)[0]).toBeNaN()
  })

  it('box-resamples 512 px tiles to 256 px, ignoring NaN', () => {
    const big = new Float32Array(512 * 512).map((_, i) => (i % 512) < 256 ? 10 : 20)
    big[0] = NaN
    const t = toTileSize(big, 512)
    expect(t.length).toBe(TILE_SIZE * TILE_SIZE)
    expect(t[0]).toBe(10) // mean of the 3 valid cells
    expect(t[TILE_SIZE - 1]).toBe(20)
  })

  it('upsamples beyond the service max zoom from the parent tile', async () => {
    const calls = []
    const load = rgbTileLoader({
      provider: 'test', decode: decodeTerrarium, maxZoom: 10, urlFor: (z, x, y) => `${z}/${x}/${y}`,
      fetchPixels: async url => {
        calls.push(url)
        const rgba = new Uint8ClampedArray(256 * 256 * 4)
        for (let i = 0; i < 256 * 256; i++) { rgba[i * 4] = 128; rgba[i * 4 + 1] = i % 256; rgba[i * 4 + 3] = 255 }
        return { rgba, width: 256, height: 256 }
      },
    })
    const t = await load(11, 3, 5) // child (1, 1) of parent 10/1/2
    expect(calls).toEqual(['10/1/2'])
    expect(t[0]).toBe(128 * 256 + 128 - 32768) // parent column 128
  })
})

describe('lon/lat rasters → Mercator tiles', () => {
  // A plane: elevation = 1000 * lon + 10 * lat, on a 0.01° grid
  const plane = (west, north, n = 120, d = 0.01) => {
    const data = new Float32Array(n * n)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      data[i * n + j] = 1000 * (west + (j + 0.5) * d) + 10 * (north - (i + 0.5) * d)
    }
    return { data, width: n, height: n, west, north, dx: d, dy: d }
  }

  it('samples a plane exactly with bilinear interpolation', () => {
    const p = plane(30, 40)
    expect(samplePiece(p, 30.123, 39.5)).toBeCloseTo(1000 * 30.123 + 10 * 39.5, 3)
    expect(samplePiece(p, 29, 39.5)).toBeUndefined()
  })

  it('assembles tiles from blocks and reproduces the source surface', async () => {
    const reads = []
    const load = rasterTileLoader({
      blockDeg: 0.5,
      readBlock: async (w, s, e, n) => { reads.push([w, s]); return [plane(w - 0.1, n + 0.1, 70)] },
    })
    const z = 10
    const [gx, gy] = lonLatToGlobalPx(30.3, 39.7, z)
    const tx = Math.floor(gx / TILE_SIZE), ty = Math.floor(gy / TILE_SIZE)
    const tile = await load(z, tx, ty)
    const c = Math.floor(gx) - tx * TILE_SIZE, r = Math.floor(gy) - ty * TILE_SIZE
    expect(tile[r * TILE_SIZE + c]).toBeCloseTo(1000 * 30.3 + 10 * 39.7, -1)
    // a second tile in the same block reuses it
    await load(z, tx + 1, ty)
    expect(new Set(reads.map(String)).size).toBe(reads.length)
  })

  it('shifts PixelIsPoint rasters by half a pixel to get the corner', () => {
    const fake = (type) => ({
      getOrigin: () => [41, 38, 0],
      getResolution: () => [1 / 3600, -1 / 3600, 0],
      getGeoKeys: () => ({ GTRasterTypeGeoKey: type }),
      getWidth: () => 3600, getHeight: () => 3600,
    })
    expect(imageGeoref(fake(1)).west).toBe(41)
    expect(imageGeoref(fake(2)).west).toBeCloseTo(41 - 0.5 / 3600, 12)
    expect(imageGeoref(fake(2)).north).toBeCloseTo(38 + 0.5 / 3600, 12)
  })
})

describe('source registry', () => {
  it('has unique ids, and every keyed source names a known key provider', () => {
    expect(new Set(SOURCES.map(s => s.id)).size).toBe(SOURCES.length)
    for (const s of SOURCES) {
      if (s.group === 'key') expect(KEY_PROVIDERS[s.keyProvider]).toBeDefined()
      else expect(s.keyProvider).toBeUndefined()
      expect(typeof s.create).toBe('function')
    }
    expect(sourceById('nope').id).toBe(SOURCES[0].id)
  })
})
