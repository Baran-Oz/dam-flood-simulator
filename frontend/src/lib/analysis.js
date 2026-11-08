/**
 * Orchestrates a reservoir analysis: picks the terrain resolution, loads tiles,
 * runs the engine and grows the analysis area until the whole reservoir fits.
 */

import { TILE_SIZE, lonLatToGlobalPx, globalPxToLonLat, metersPerPixel, polylineLength } from './geo.js'
import { simulateReservoir, axisBase, tieInAxis } from './reservoir.js'

// z12 ≈ 30 m/px at 40° latitude, matching the native SRTM resolution. Finer zooms
// are upsampled and add nothing. Coarser than z11 (~60 m) the valley sides at the
// dam's ends blur below the crest, causing false leaks, so we never go below that.
export const START_ZOOM = 12
export const MIN_ZOOM = 11
export const PIXEL_BUDGET = 16e6  // ~64 MB of elevation data
const PAD_TILES = 2
const MAX_TIE_IN_M = 5000 // longest extension allowed at each end of the axis

const tileCount = b => (b.tx1 - b.tx0 + 1) * (b.ty1 - b.ty0 + 1)
const pixels = b => tileCount(b) * TILE_SIZE * TILE_SIZE

function damBounds(dam, z, pad) {
  const max = 2 ** z - 1
  const px = dam.map(([lon, lat]) => lonLatToGlobalPx(lon, lat, z))
  const xs = px.map(p => Math.floor(p[0] / TILE_SIZE))
  const ys = px.map(p => Math.floor(p[1] / TILE_SIZE))
  return {
    tx0: Math.max(0, Math.min(...xs) - pad),
    tx1: Math.min(max, Math.max(...xs) + pad),
    ty0: Math.max(0, Math.min(...ys) - pad),
    ty1: Math.min(max, Math.max(...ys) + pad),
  }
}

/** Grow the bounds on the touched sides: by half the span, or by just PAD_TILES when `minimal`. */
function expand(b, touches, z, minimal = false) {
  const max = 2 ** z - 1
  const gx = minimal ? PAD_TILES : Math.max(PAD_TILES, Math.ceil((b.tx1 - b.tx0 + 1) * 0.5))
  const gy = minimal ? PAD_TILES : Math.max(PAD_TILES, Math.ceil((b.ty1 - b.ty0 + 1) * 0.5))
  return {
    tx0: touches.west ? Math.max(0, b.tx0 - gx) : b.tx0,
    tx1: touches.east ? Math.min(max, b.tx1 + gx) : b.tx1,
    ty0: touches.north ? Math.max(0, b.ty0 - gy) : b.ty0,
    ty1: touches.south ? Math.min(max, b.ty1 + gy) : b.ty1,
  }
}

const halve = b => ({ tx0: b.tx0 >> 1, tx1: b.tx1 >> 1, ty0: b.ty0 >> 1, ty1: b.ty1 >> 1 })
const sameBounds = (a, b) => a.tx0 === b.tx0 && a.tx1 === b.tx1 && a.ty0 === b.ty0 && a.ty1 === b.ty1

export async function buildGrid(z, b, loadTile) {
  const cols = b.tx1 - b.tx0 + 1
  const rows = b.ty1 - b.ty0 + 1
  const width = cols * TILE_SIZE
  const height = rows * TILE_SIZE
  const data = new Float32Array(width * height)

  const jobs = []
  for (let ty = b.ty0; ty <= b.ty1; ty++) {
    for (let tx = b.tx0; tx <= b.tx1; tx++) {
      jobs.push(
        loadTile(z, tx, ty).then(tile => {
          const c0 = (tx - b.tx0) * TILE_SIZE
          const r0 = (ty - b.ty0) * TILE_SIZE
          for (let r = 0; r < TILE_SIZE; r++) {
            data.set(tile.subarray(r * TILE_SIZE, (r + 1) * TILE_SIZE), (r0 + r) * width + c0)
          }
        }),
      )
    }
  }
  await Promise.all(jobs)
  return { data, width, height, z, x0: b.tx0 * TILE_SIZE, y0: b.ty0 * TILE_SIZE }
}

/**
 * @param params.dam     [[lon, lat], ...] dam axis
 * @param params.height  dam height above riverbed (m)
 * @param params.side    'auto' | 1 | -1
 * @param params.startZoom finest zoom to try first (default START_ZOOM; finer data can use more)
 * @param params.tieIn   extend the axis ends into ground above the crest (default true)
 * @param params.region  optional { z, bounds, base } from a previous run with the same dam
 * @param deps.loadTile  (z, x, y) => Promise<Float32Array>
 * @param deps.onProgress (message) => void
 * @param deps.isCancelled () => boolean
 * @returns null if cancelled, otherwise { grid, sim, result }
 */
export async function analyzeReservoir(params, deps) {
  const { dam, height, side = 'auto', region, tieIn = true, startZoom = START_ZOOM } = params
  const { loadTile, onProgress = () => {}, isCancelled = () => false } = deps

  let z = region?.z ?? startZoom
  let b = region?.bounds ?? damBounds(dam, z, PAD_TILES)
  // Riverbed elevation comes from the finest grid and is then held fixed
  let base = region?.base ?? null
  // Axis actually used (with tie-in extensions), fixed on the first grid in lon/lat
  let axis = null

  for (;;) {
    while (pixels(b) > PIXEL_BUDGET && z > MIN_ZOOM) {
      b = halve(b)
      z--
    }

    const mpp = metersPerPixel(((b.ty0 + b.ty1 + 1) / 2) * TILE_SIZE, z)
    onProgress(`Loading terrain: ${tileCount(b)} tiles at ~${Math.round(mpp)} m/px`)
    const grid = await buildGrid(z, b, loadTile)
    if (isCancelled()) return null

    onProgress('Filling reservoir…')
    const toPx = ([lon, lat]) => lonLatToGlobalPx(lon, lat, z)
    if (!axis) {
      const userPx = dam.map(toPx)
      if (base == null) base = axisBase(grid, userPx)
      axis = { coords: dam, startM: 0, endM: 0, sealed: true }
      if (tieIn && base != null) {
        const mppDam = metersPerPixel(userPx[0][1], z)
        const t = tieInAxis(grid, userPx, base + height, Math.round(MAX_TIE_IN_M / mppDam))
        axis = {
          coords: t.damPx.map(([x, y]) => globalPxToLonLat(x, y, z)),
          startM: t.startPx * mppDam,
          endM: t.endPx * mppDam,
          sealed: t.sealed,
        }
      }
    }
    const sim = simulateReservoir(grid, axis.coords.map(toPx), height, side, { base })
    if (base == null && sim.base != null) base = sim.base

    const t = sim.touches
    const touchesEdge = sim.status === 'ok' && !sim.leak && (t.north || t.south || t.west || t.east)
    if (!touchesEdge) return finish(grid, sim, { z, bounds: b }, false)

    let next = expand(b, t, z)
    // At the coarsest zoom, a big step may not fit while a small one still does
    if (pixels(next) > PIXEL_BUDGET && z <= MIN_ZOOM) next = expand(b, t, z, true)
    const stuck = sameBounds(next, b) || (pixels(next) > PIXEL_BUDGET && z <= MIN_ZOOM)
    if (stuck) return finish(grid, sim, { z, bounds: b }, true)
    b = next
  }

  function finish(grid, sim, reg, truncated) {
    const toLonLat = (r, c) => globalPxToLonLat(grid.x0 + c + 0.5, grid.y0 + r + 0.5, grid.z)
    const seed = sim.seedIdx >= 0
      ? toLonLat(Math.floor(sim.seedIdx / grid.width), sim.seedIdx % grid.width)
      : null
    // The rasterised axis is a pixel staircase; scale its distances to the true length
    const damLength = polylineLength(dam)
    const crestLength = polylineLength(axis.coords)
    const rawLen = sim.profile.length ? sim.profile[sim.profile.length - 1].d : 0
    const k = rawLen > 0 ? crestLength / rawLen : 1
    const t = sim.touches
    const [west, north] = globalPxToLonLat(grid.x0, grid.y0, grid.z)
    const [east, south] = globalPxToLonLat(grid.x0 + grid.width, grid.y0 + grid.height, grid.z)
    const profile = sim.profile.map(p => ({ d: p.d * k, elev: p.elev }))

    const result = {
      status: sim.status,
      height,
      base: sim.base,
      crest: sim.crest,
      side: sim.side,
      autoSide: sim.autoSide,
      area_m2: sim.area_m2 ?? 0,
      volume_m3: sim.volume_m3 ?? 0,
      maxDepth: sim.maxDepth ?? 0,
      meanDepth: sim.area_m2 ? sim.volume_m3 / sim.area_m2 : 0,
      leak: !!sim.leak,
      maxSealingHeight: sim.maxSealingHeight ?? null,
      truncated,
      profile,
      damLength,
      crestLength,
      axis: axis.coords,
      tieIn: { startM: axis.startM, endM: axis.endM, sealed: axis.sealed },
      // The flood stops at the edge of the loaded terrain (leak or size limit)
      edgeLimited: sim.status === 'ok' && !!t && (t.north || t.south || t.west || t.east),
      gridBounds: [[south, west], [north, east]],
      resolution: metersPerPixel(grid.y0 + (sim.deepestCell?.r ?? 0) + 0.5, grid.z),
      upstreamPoint: seed,
      region: { ...reg, base },
    }
    return { grid, sim, result }
  }
}
