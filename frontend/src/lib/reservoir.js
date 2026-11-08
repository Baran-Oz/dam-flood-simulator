/**
 * Reservoir engine: pure functions on a DEM grid, no DOM and no network.
 *
 * Grid: {
 *   data   : Float32Array  elevation in m (row-major, NaN = no data)
 *   width, height         : grid size in pixels
 *   z                     : Web Mercator zoom the grid is sampled at
 *   x0, y0                : global pixel coordinates of the grid's top-left corner
 * }
 *
 * The model:
 *   base  = lowest ground along the dam axis (the riverbed)
 *   crest = base + dam height
 *   The reservoir is every cell connected to the upstream foot of the dam whose
 *   ground is below the crest. The dam axis is a wall the water cannot cross,
 *   but water can still flow around the dam's ends. When that happens the flood
 *   reaches the downstream foot of the dam, and the result is flagged as a leak.
 */

import { metersPerPixel } from './geo.js'

/**
 * Rasterise the dam polyline (global px at grid.z) into an 8-connected line of cells.
 * With 4-connected flood filling, an 8-connected line is watertight.
 */
export function rasterizeDam(grid, damPx) {
  const { width, height, x0, y0 } = grid
  const mask = new Uint8Array(width * height)
  const cells = [] // ordered along the axis: { r, c, seg }

  for (let s = 0; s < damPx.length - 1; s++) {
    let c = Math.floor(damPx[s][0] - x0)
    let r = Math.floor(damPx[s][1] - y0)
    const c1 = Math.floor(damPx[s + 1][0] - x0)
    const r1 = Math.floor(damPx[s + 1][1] - y0)
    const dc = Math.abs(c1 - c), sc = c < c1 ? 1 : -1
    const dr = -Math.abs(r1 - r), sr = r < r1 ? 1 : -1
    let err = dc + dr
    for (;;) {
      if (r < 0 || r >= height || c < 0 || c >= width) {
        throw new Error('Dam axis lies outside the terrain grid')
      }
      const last = cells[cells.length - 1]
      if (!last || last.r !== r || last.c !== c) {
        cells.push({ r, c, seg: s })
        mask[r * width + c] = 1
      }
      if (c === c1 && r === r1) break
      const e2 = 2 * err
      if (e2 >= dr) { err += dr; c += sc }
      if (e2 <= dc) { err += dc; r += sr }
    }
  }
  return { mask, cells }
}

/** Riverbed elevation: the lowest valid ground on the dam axis (null if none). */
export function axisBase(grid, damPx) {
  const { cells } = rasterizeDam(grid, damPx)
  let base = Infinity
  for (const { r, c } of cells) {
    const e = grid.data[r * grid.width + c]
    if (e < base) base = e
  }
  return Number.isFinite(base) ? base : null
}

/**
 * Tie the dam into the valley sides. Real dams continue into the hillside until
 * the ground is higher than the crest. A hand-drawn axis usually stops short,
 * which would let the water flow round its ends. Each end is extended along the
 * direction of its end segment until it sits in ground above the crest for a few
 * consecutive cells, or until maxExtPx is used up.
 *
 * @returns { damPx, startPx, endPx, sealed } where startPx/endPx are the extension
 *          lengths in pixels and sealed says whether both ends reached high ground.
 */
export function tieInAxis(grid, damPx, crest, maxExtPx) {
  const { data, width, height, x0, y0 } = grid
  const HOLD = 3 // consecutive above-crest cells needed

  const extend = (p, q) => {
    const dx = p[0] - q[0], dy = p[1] - q[1]
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    let run = 0
    for (let t = 0; t <= maxExtPx; t++) {
      const x = p[0] + ux * t, y = p[1] + uy * t
      const c = Math.floor(x - x0), r = Math.floor(y - y0)
      if (r < 0 || r >= height || c < 0 || c >= width) {
        return { pt: [p[0] + ux * Math.max(0, t - 1), p[1] + uy * Math.max(0, t - 1)], t: Math.max(0, t - 1), ok: false }
      }
      run = data[r * width + c] >= crest ? run + 1 : 0
      if (run >= HOLD) return { pt: [x, y], t: t < HOLD ? 0 : t, ok: true }
    }
    return { pt: [p[0] + ux * maxExtPx, p[1] + uy * maxExtPx], t: maxExtPx, ok: false }
  }

  const n = damPx.length
  const s = extend(damPx[0], damPx[1])
  const e = extend(damPx[n - 1], damPx[n - 2])
  const out = damPx.slice()
  if (s.t > 0) out.unshift(s.pt)
  if (e.t > 0) out.push(e.pt)
  return { damPx: out, startPx: s.t, endPx: e.t, sealed: s.ok && e.ok }
}

/** Ground profile along the dam axis: [{ d: metres from start, elev }] */
function damProfile(grid, cells) {
  const profile = []
  let d = 0
  for (let i = 0; i < cells.length; i++) {
    const { r, c } = cells[i]
    if (i > 0) {
      const p = cells[i - 1]
      d += Math.hypot(r - p.r, c - p.c) * metersPerPixel(grid.y0 + r + 0.5, grid.z)
    }
    const e = grid.data[r * grid.width + c]
    profile.push({ d, elev: Number.isNaN(e) ? null : e })
  }
  return profile
}

/** First non-dam cell walking away from (r, c) along `dir` (unit vector in px). */
function stepOff(grid, mask, r, c, dir) {
  for (let t = 1; t <= 12; t++) {
    const rr = Math.round(r + dir[1] * t)
    const cc = Math.round(c + dir[0] * t)
    if (rr < 0 || rr >= grid.height || cc < 0 || cc >= grid.width) return -1
    const idx = rr * grid.width + cc
    if (!mask[idx]) return idx
  }
  return -1
}

/**
 * Cells just off one face of the dam: from every dam cell, step along its own
 * segment's normal (sign +1 or -1) to the first non-dam cell. Using the whole
 * face, rather than one cell next to the riverbed, means a single odd pixel
 * (a rock, a bridge pier, a DEM spike) cannot decide the answer.
 */
function faceCells(grid, mask, cells, damPx, sign) {
  const out = new Set()
  for (const { r, c, seg } of cells) {
    const dx = damPx[seg + 1][0] - damPx[seg][0]
    const dy = damPx[seg + 1][1] - damPx[seg][1]
    const len = Math.hypot(dx, dy) || 1
    const idx = stepOff(grid, mask, r, c, [(-dy / len) * sign, (dx / len) * sign])
    if (idx >= 0) out.add(idx)
  }
  return out
}

/**
 * Guess which side of the dam is upstream by following the river. From each face,
 * a priority flood always explores the lowest cell next, so it traces the
 * riverbed. Downstream the bed keeps falling, and within a few hundred thousand
 * cells the trace is far below the riverbed at the dam. Upstream the bed rises,
 * so the trace has to climb and its lowest point stays near the dam.
 *
 * Following the lowest path matters on big, gently sloping rivers (~0.5 m/km):
 * spreading out evenly covers only a few kilometres, where DEM noise of a few
 * metres outweighs the slope.
 * The trace is capped at the crest. The dam's ends reach above it (that is what
 * the tie-in ensures), so the trace can't walk round an end onto the other side.
 * Returns +1 (along the dam normal) or -1.
 */
function guessUpstreamSide(grid, mask, faces, base, crest) {
  const lowest = (sign, level) => {
    const seeds = [...faces[sign]].filter(i => grid.data[i] < level)
    return seeds.length ? lowestAlongValley(grid, mask, seeds, level, 200000) : Infinity
  }
  // A tie means both traces met, e.g. round an end of an axis that stops below
  // the crest; retry lower, closer to the riverbed.
  for (const level of [Math.max(crest, base + 3), base + 10, base + 3]) {
    const minus = lowest(-1, level), plus = lowest(1, level)
    if (Math.abs(minus - plus) > 0.01) return minus > plus ? -1 : 1
  }
  return 1
}

/**
 * Lowest ground reached by a priority flood (lowest cell first) from the seeds,
 * through non-dam cells below `level`, visiting at most maxCells.
 */
export function lowestAlongValley(grid, mask, seeds, level, maxCells) {
  const { data, width, height } = grid
  const seen = new Uint8Array(width * height)
  const heap = new MinHeap(maxCells * 4 + seeds.length)
  for (const s of seeds) {
    if (seen[s]) continue
    seen[s] = 1
    heap.push(s, data[s])
  }
  let lowest = Infinity, visited = 0
  while (heap.size && visited < maxCells) {
    const idx = heap.pop()
    visited++
    const e = data[idx]
    if (e < lowest) lowest = e
    const r = (idx / width) | 0
    const c = idx - r * width
    if (r > 0) visit(idx - width)
    if (r < height - 1) visit(idx + width)
    if (c > 0) visit(idx - 1)
    if (c < width - 1) visit(idx + 1)
  }
  return lowest

  function visit(j) {
    if (seen[j] || mask[j] || !(data[j] < level)) return
    seen[j] = 1
    if (heap.size < heap.capacity) heap.push(j, data[j])
  }
}

/** Binary min-heap of cell indices keyed by elevation. */
class MinHeap {
  constructor(capacity) {
    this.capacity = capacity
    this.keys = new Float32Array(capacity)
    this.vals = new Int32Array(capacity)
    this.size = 0
  }
  push(val, key) {
    let i = this.size++
    const { keys, vals } = this
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]; vals[i] = vals[p]
      i = p
    }
    keys[i] = key; vals[i] = val
  }
  pop() {
    const { keys, vals } = this
    const top = vals[0]
    const n = --this.size
    if (n > 0) {
      const key = keys[n], val = vals[n]
      let i = 0
      for (;;) {
        let m = 2 * i + 1
        if (m >= n) break
        if (m + 1 < n && keys[m + 1] < keys[m]) m++
        if (keys[m] >= key) break
        keys[i] = keys[m]; vals[i] = vals[m]
        i = m
      }
      keys[i] = key; vals[i] = val
    }
    return top
  }
}

/**
 * 4-connected flood fill from the seeds over non-dam cells with ground < level.
 * Seeds at or above the level are skipped. If `stop` (a Uint8Array mask) is
 * given, the fill ends as soon as it reaches a marked cell (reachedStop = true).
 */
export function floodFill(grid, mask, seeds, level, stop = null, scratch = null) {
  const { data, width, height } = grid
  const n = width * height
  const flood = scratch ? scratch.flood.fill(0) : new Uint8Array(n)
  const queue = scratch ? scratch.queue : new Int32Array(n)
  const touches = { north: false, south: false, west: false, east: false }
  let head = 0, tail = 0

  for (const s of typeof seeds === 'number' ? [seeds] : seeds) {
    if (flood[s] || mask[s] || !(data[s] < level)) continue
    flood[s] = 1
    queue[tail++] = s
  }

  while (head < tail) {
    const idx = queue[head++]
    if (stop && stop[idx]) return { flood, count: tail, touches, reachedStop: true }
    const r = (idx / width) | 0
    const c = idx - r * width
    if (r === 0) touches.north = true
    if (r === height - 1) touches.south = true
    if (c === 0) touches.west = true
    if (c === width - 1) touches.east = true

    // N, S, W, E
    if (r > 0) visit(idx - width)
    if (r < height - 1) visit(idx + width)
    if (c > 0) visit(idx - 1)
    if (c < width - 1) visit(idx + 1)
  }
  return { flood, count: tail, touches, reachedStop: false }

  function visit(j) {
    if (flood[j] || mask[j]) return
    const e = data[j]
    if (!(e < level)) return // also rejects NaN
    flood[j] = 1
    queue[tail++] = j
  }
}

/**
 * Simulate a reservoir filled to the dam crest.
 *
 * @param grid     DEM grid (see top of file)
 * @param damPx    dam axis as [[gx, gy], ...] global pixels at grid.z
 * @param heightM  dam height above the riverbed, metres
 * @param side     'auto' | 1 | -1: upstream side relative to the dam normal
 * @param opts.base  riverbed elevation to use instead of this grid's minimum on the
 *                   dam axis (keeps the crest fixed when a coarser grid is used)
 */
export function simulateReservoir(grid, damPx, heightM, side = 'auto', opts = {}) {
  const { mask, cells } = rasterizeDam(grid, damPx)
  const profile = damProfile(grid, cells)

  // Riverbed = lowest valid ground on the dam axis
  let deepest = -1, base = Infinity
  for (let i = 0; i < cells.length; i++) {
    const e = profile[i].elev
    if (e !== null && e < base) { base = e; deepest = i }
  }
  if (deepest < 0) return { status: 'nodata', profile }
  if (opts.base != null) base = opts.base

  // Cells along each face of the dam. A cell claimed by both faces (at a sharp
  // bend in the axis) belongs to neither.
  const faces = { 1: faceCells(grid, mask, cells, damPx, 1), [-1]: faceCells(grid, mask, cells, damPx, -1) }
  for (const i of [...faces[1]]) {
    if (faces[-1].has(i)) { faces[1].delete(i); faces[-1].delete(i) }
  }

  const crest = base + heightM
  const autoSide = guessUpstreamSide(grid, mask, faces, base, crest)
  const upSide = side === 1 || side === -1 ? side : autoSide
  const { data, width, height } = grid

  const seeds = [...faces[upSide]].filter(i => data[i] < crest)
  const downstream = new Uint8Array(width * height)
  for (const i of faces[-upSide]) downstream[i] = 1

  // Map marker: the upstream seed nearest the riverbed
  const { r, c } = cells[deepest]
  let seedIdx = -1, best = Infinity
  for (const i of seeds) {
    const d = (((i / width) | 0) - r) ** 2 + ((i % width) - c) ** 2
    if (d < best) { best = d; seedIdx = i }
  }

  const common = { base, crest, side: upSide, autoSide, profile, seedIdx, deepestCell: { r, c }, mask }

  if (!seeds.length) {
    return { ...common, status: 'dry', area_m2: 0, volume_m3: 0, maxDepth: 0 }
  }

  const fill = floodFill(grid, mask, seeds, crest)
  let leak = false
  for (const i of faces[-upSide]) {
    if (fill.flood[i]) { leak = true; break }
  }

  // Area / volume / depth, with per-row cell areas (Mercator scale varies with latitude)
  const rowArea = new Float64Array(height)
  for (let rr = 0; rr < height; rr++) {
    rowArea[rr] = metersPerPixel(grid.y0 + rr + 0.5, grid.z) ** 2
  }
  let area = 0, volume = 0, maxDepth = 0
  let r0 = height, r1 = -1, c0 = width, c1 = -1
  for (let idx = 0; idx < fill.flood.length; idx++) {
    if (!fill.flood[idx]) continue
    const rr = (idx / width) | 0
    const cc = idx - rr * width
    const depth = crest - data[idx]
    area += rowArea[rr]
    volume += depth * rowArea[rr]
    if (depth > maxDepth) maxDepth = depth
    if (rr < r0) r0 = rr
    if (rr > r1) r1 = rr
    if (cc < c0) c0 = cc
    if (cc > c1) c1 = cc
  }

  const result = {
    ...common,
    status: 'ok',
    flood: fill.flood,
    floodBox: { r0, r1, c0, c1 },
    touches: fill.touches,
    leak,
    area_m2: area,
    volume_m3: volume,
    maxDepth,
  }

  if (leak) result.maxSealingHeight = maxSealingHeight(grid, mask, [...faces[upSide]], downstream, base, heightM)
  return result
}

/** Largest dam height (to 0.25 m) at which water does not reach the downstream face. */
function maxSealingHeight(grid, mask, seeds, downstream, base, hi) {
  const n = grid.width * grid.height
  const scratch = { flood: new Uint8Array(n), queue: new Int32Array(n) }
  const leaks = h => floodFill(grid, mask, seeds, base + h, downstream, scratch).reachedStop
  let lo = 0
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2
    if (leaks(mid)) hi = mid
    else lo = mid
  }
  return lo
}
