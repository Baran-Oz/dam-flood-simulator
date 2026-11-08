import { describe, it, expect } from 'vitest'
import { simulateReservoir, tieInAxis, axisBase } from './reservoir.js'
import { analyzeReservoir, START_ZOOM } from './analysis.js'
import { lonLatToGlobalPx, globalPxToLonLat, metersPerPixel, haversine, TILE_SIZE } from './geo.js'

const Z = 13
const [GX, GY] = lonLatToGlobalPx(33, 40, Z).map(v => Math.floor(v / TILE_SIZE) * TILE_SIZE)

/**
 * V-shaped valley centred on column 100, river flowing south (rows increase downstream).
 * ground(r, c) = 100 + |c - 100| + 0.5 * (200 - r)
 */
const ground = (r, c) => 100 + Math.abs(c - 100) + 0.5 * (200 - r)

function valleyGrid(w = 200, h = 200) {
  const data = new Float32Array(w * h)
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = ground(r, c)
  return { data, width: w, height: h, z: Z, x0: GX, y0: GY }
}

// Dam across the valley at row 150, drawn west → east, cell centres
const damAcross = (c0, c1, r = 150) => [
  [GX + c0 + 0.5, GY + r + 0.5],
  [GX + c1 + 0.5, GY + r + 0.5],
]

/** Independent brute-force answer: every cell upstream of the dam row below the crest. */
function expected(crest, damRow = 150) {
  let area = 0, volume = 0
  for (let r = 0; r < damRow; r++) {
    const a = metersPerPixel(GY + r + 0.5, Z) ** 2
    for (let c = 0; c < 200; c++) {
      const e = ground(r, c)
      if (e < crest) { area += a; volume += (crest - e) * a }
    }
  }
  return { area, volume }
}

describe('simulateReservoir', () => {
  it('fills to base + height upstream only, matching a brute-force count', () => {
    const sim = simulateReservoir(valleyGrid(), damAcross(40, 160), 30)
    expect(sim.status).toBe('ok')
    expect(sim.base).toBe(125)          // riverbed at (150, 100)
    expect(sim.crest).toBe(155)
    expect(sim.leak).toBe(false)
    expect(sim.maxDepth).toBeCloseTo(30 - 0.5, 5) // deepest flooded cell is one row upstream

    const exp = expected(155)
    expect(sim.area_m2).toBeCloseTo(exp.area, 0)
    expect(sim.volume_m3).toBeCloseTo(exp.volume, 0)

    // nothing downstream of the dam is wet
    for (let r = 151; r < 200; r++) {
      for (let c = 0; c < 200; c++) expect(sim.flood[r * 200 + c]).toBe(0)
    }
  })

  it('detects the upstream side automatically and allows flipping it', () => {
    const auto = simulateReservoir(valleyGrid(), damAcross(40, 160), 30)
    expect(Math.floor(auto.seedIdx / 200)).toBeLessThan(150) // north = upstream

    // Same dam drawn east → west: normal flips, the answer must not
    const reversed = simulateReservoir(valleyGrid(), damAcross(40, 160).reverse(), 30)
    expect(reversed.volume_m3).toBeCloseTo(auto.volume_m3, 0)

    const flipped = simulateReservoir(valleyGrid(), damAcross(40, 160), 30, -auto.side)
    expect(Math.floor(flipped.seedIdx / 200)).toBeGreaterThan(150)
  })

  it('finds upstream even when the cell just below the riverbed is high ground', () => {
    // A 3 × 3 rock right under the riverbed cell (150, 100) on the downstream side.
    // Starting the side test from that single cell would see only the rock and call it upstream.
    const grid = valleyGrid()
    for (let r = 151; r <= 153; r++) for (let c = 99; c <= 101; c++) grid.data[r * 200 + c] = 300
    const sim = simulateReservoir(grid, damAcross(40, 160), 30)
    expect(sim.autoSide).toBe(-1) // north
    expect(Math.floor(sim.seedIdx / 200)).toBeLessThan(150)
    expect(sim.leak).toBe(false)
    expect(sim.volume_m3).toBeCloseTo(expected(155).volume, 0)
  })

  it('finds upstream on a gently sloping river with noisy terrain', () => {
    // 0.02 m/cell river slope (like 0.6 m/km at 30 m cells) plus ±3 m noise:
    // a few metres of noise near the dam outweigh the slope, but the downstream
    // trace along the riverbed falls far below the dam within the grid.
    const w = 400, h = 1200
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 6
    const data = new Float32Array(w * h)
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      data[r * w + c] = 100 + 0.5 * Math.abs(c - 200) + 0.02 * (h - r) + rnd()
    }
    const grid = { data, width: w, height: h, z: Z, x0: GX, y0: GY }
    const damRow = 600
    const dam = [[GX + 120.5, GY + damRow + 0.5], [GX + 280.5, GY + damRow + 0.5]]
    const sim = simulateReservoir(grid, dam, 20)
    expect(sim.autoSide).toBe(-1) // north = upstream (ground rises with smaller r)
    expect(sim.leak).toBe(false)
  })

  it('flags a leak when the dam does not reach high enough ground, and finds the sealing height', () => {
    // Dam ends at columns 80 and 120. To get around an end the water must pass
    // (149, 121) at 146.5 m, so it seals up to a crest of 146.5 m = 21.5 m height.
    const sim = simulateReservoir(valleyGrid(), damAcross(80, 120), 30)
    expect(sim.leak).toBe(true)
    expect(sim.maxSealingHeight).toBeGreaterThan(21.25)
    expect(sim.maxSealingHeight).toBeLessThanOrEqual(21.5)

    const sealed = simulateReservoir(valleyGrid(), damAcross(80, 120), 20)
    expect(sealed.leak).toBe(false)
  })

  it('is watertight for a diagonal dam', () => {
    // Diagonal dam across a valley still blocks the 4-connected fill
    const dam = [
      [GX + 40.5, GY + 130.5],
      [GX + 160.5, GY + 170.5],
    ]
    const sim = simulateReservoir(valleyGrid(), dam, 25)
    expect(sim.leak).toBe(false)
  })

  it('reports a dry reservoir when the height is ~0', () => {
    const sim = simulateReservoir(valleyGrid(), damAcross(40, 160), 0)
    expect(sim.status).toBe('dry')
  })
})

describe('tieInAxis', () => {
  it('extends a short axis into the valley sides so the dam seals', () => {
    const grid = valleyGrid()
    const short = damAcross(80, 120)
    const base = axisBase(grid, short)
    expect(base).toBe(125)
    const t = tieInAxis(grid, short, base + 30, 100)
    expect(t.sealed).toBe(true)
    // ground reaches 155 at |c - 100| = 30, so each end moves out ~10 px (+ hold margin)
    expect(t.startPx).toBeGreaterThanOrEqual(10)
    expect(t.startPx).toBeLessThanOrEqual(13)
    expect(t.endPx).toBeGreaterThanOrEqual(10)
    expect(t.endPx).toBeLessThanOrEqual(13)

    const sim = simulateReservoir(grid, t.damPx, 30)
    expect(sim.leak).toBe(false)
    expect(sim.volume_m3).toBeCloseTo(expected(155).volume, 0)
  })

  it('leaves an axis that already reaches high ground unchanged', () => {
    const grid = valleyGrid()
    const t = tieInAxis(grid, damAcross(40, 160), 155, 100)
    expect(t.startPx).toBe(0)
    expect(t.endPx).toBe(0)
    expect(t.damPx).toHaveLength(2)
  })

  it('reports an end that never reaches high ground within the limit', () => {
    const t = tieInAxis(valleyGrid(), damAcross(80, 120), 400, 30)
    expect(t.sealed).toBe(false)
  })
})

describe('analyzeReservoir', () => {
  it('grows the analysis area until the reservoir fits', async () => {
    // Long gentle valley in global pixel space (z13): reservoir extends ~2000 px north
    const cx = GX + 600, damRow = GY + 3000
    const g = (gy, gx) => 100 + Math.abs(gx - cx) * 0.5 + 0.02 * (damRow - gy)
    // Terrain is defined in z13 pixels; tiles of any zoom sample it
    const loadTile = async (z, tx, ty) => {
      const k = 2 ** (Z - z)
      const t = new Float32Array(TILE_SIZE * TILE_SIZE)
      for (let r = 0; r < TILE_SIZE; r++) {
        for (let c = 0; c < TILE_SIZE; c++) {
          t[r * TILE_SIZE + c] = g((ty * TILE_SIZE + r + 0.5) * k, (tx * TILE_SIZE + c + 0.5) * k)
        }
      }
      return t
    }
    const dam = [
      globalPxToLonLat(cx - 150, damRow + 0.5, Z),
      globalPxToLonLat(cx + 150, damRow + 0.5, Z),
    ]
    const out = await analyzeReservoir({ dam, height: 40 }, { loadTile })
    const { result, sim, grid } = out
    expect(result.status).toBe('ok')
    expect(result.leak).toBe(false)
    expect(result.truncated).toBe(false)
    expect(result.region.z).toBe(START_ZOOM)
    expect(sim.touches.north).toBe(false)
    // The analysis area must have grown beyond the initial 2-tile pad
    expect(grid.height).toBeGreaterThan(5 * TILE_SIZE)
    // Reservoir length ≈ height / slope = 40 / 0.02 = 2000 z13 px
    const rows = (sim.floodBox.r1 - sim.floodBox.r0 + 1) * 2 ** (Z - START_ZOOM)
    expect(rows).toBeGreaterThan(1950)
    expect(rows).toBeLessThan(2010)
  })

  it('keeps the crest fixed when it has to fall back to a coarser zoom', async () => {
    // Very long valley so the area exceeds the pixel budget at START_ZOOM
    const cx = GX + 600, damRow = GY + 30000
    const g = (gy, gx) => 100 + Math.abs(gx - cx) * 0.5 + 0.004 * (damRow - gy)
    const loadTile = async (z, tx, ty) => {
      const k = 2 ** (Z - z)
      const t = new Float32Array(TILE_SIZE * TILE_SIZE)
      for (let r = 0; r < TILE_SIZE; r++) {
        for (let c = 0; c < TILE_SIZE; c++) {
          t[r * TILE_SIZE + c] = g((ty * TILE_SIZE + r + 0.5) * k, (tx * TILE_SIZE + c + 0.5) * k)
        }
      }
      return t
    }
    const dam = [
      globalPxToLonLat(cx - 150, damRow + 0.5, Z),
      globalPxToLonLat(cx + 150, damRow + 0.5, Z),
    ]
    const fine = await analyzeReservoir({ dam, height: 10 }, { loadTile })
    const big = await analyzeReservoir({ dam, height: 60 }, { loadTile })
    expect(big.result.region.z).toBeLessThan(START_ZOOM)
    expect(big.result.base).toBeCloseTo(fine.result.base, 6)
    expect(big.result.crest).toBeCloseTo(fine.result.base + 60, 6)
  })
})

describe('geo', () => {
  it('round-trips lon/lat through global pixels', () => {
    const [x, y] = lonLatToGlobalPx(38.27, 37.48, 13)
    const [lon, lat] = globalPxToLonLat(x, y, 13)
    expect(lon).toBeCloseTo(38.27, 9)
    expect(lat).toBeCloseTo(37.48, 9)
  })

  it('pixel size matches great-circle distance', () => {
    const [x, y] = lonLatToGlobalPx(33, 40, 13)
    const a = globalPxToLonLat(x, y, 13)
    const b = globalPxToLonLat(x + 100, y, 13)
    expect(haversine(a, b) / 100).toBeCloseTo(metersPerPixel(y, 13), 1)
  })
})
