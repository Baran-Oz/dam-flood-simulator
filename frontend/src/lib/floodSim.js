/**
 * Flood simulation engine — runs entirely in the browser.
 *
 * Algorithm:
 *  1. Rasterise the dam wall polyline onto the DEM grid (Bresenham + buffer)
 *  2. BFS flood fill from the seed point, confined to cells ≤ waterLevel
 *     and not blocked by the dam mask
 *  3. Render the flooded mask to a Canvas RGBA image for the map overlay
 *  4. Calculate flooded area (km²) and water volume (m³)
 */

/** Draw a Bresenham line with a pixel buffer into a Uint8 mask */
function rasteriseLine(mask, width, height, x0, y0, x1, y1, halfBuf) {
  const dx =  Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0, y = y0

  for (;;) {
    for (let br = -halfBuf; br <= halfBuf; br++) {
      for (let bc = -halfBuf; bc <= halfBuf; bc++) {
        const nr = y + br, nc = x + bc
        if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
          mask[nr * width + nc] = 1
        }
      }
    }
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
}

/** Convert a lon/lat coordinate to the nearest DEM pixel [row, col] */
function lonLatToPixel(dem, lon, lat) {
  const col = Math.floor((lon - dem.bounds.west)  / dem.pixelWidthDeg)
  const row = Math.floor((dem.bounds.north - lat) / dem.pixelHeightDeg)
  return [
    Math.max(0, Math.min(dem.height - 1, row)),
    Math.max(0, Math.min(dem.width  - 1, col)),
  ]
}

/** Find the nearest cell that is below waterLevel and not on the dam */
function nearestValidSeed(dem, damMask, row, col, waterLevel) {
  const { data, width, height } = dem
  for (let radius = 0; radius < Math.max(width, height); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (radius > 0 && Math.abs(dr) < radius && Math.abs(dc) < radius) continue
        const r = row + dr, c = col + dc
        if (r < 0 || r >= height || c < 0 || c >= width) continue
        const idx = r * width + c
        const e = data[idx]
        if (!damMask[idx] && !isNaN(e) && e <= waterLevel) return [r, c]
      }
    }
  }
  return null
}

/**
 * Run flood simulation.
 *
 * @param {object} dem          DEM object from demTiles.fetchDEM
 * @param {number[][]} damLine  [[lon,lat], ...] polyline for the dam wall
 * @param {number} waterLevel   Water surface elevation in m ASL
 * @param {number} seedLon      Seed point longitude (reservoir side)
 * @param {number} seedLat      Seed point latitude  (reservoir side)
 *
 * @returns {{ imageDataURL: string, area_km2: number, volume_m3: number,
 *             damCrestElev: number }}
 */
export function simulate(dem, damLine, waterLevel, seedLon, seedLat) {
  const { data, width, height } = dem

  // ---- 1. Rasterise dam wall ----
  const damMask = new Uint8Array(width * height)
  const bufPx   = Math.max(1, Math.round(Math.min(width, height) / 200))  // ~0.5% of DEM

  for (let i = 0; i < damLine.length - 1; i++) {
    const [r0, c0] = lonLatToPixel(dem, damLine[i][0],     damLine[i][1])
    const [r1, c1] = lonLatToPixel(dem, damLine[i + 1][0], damLine[i + 1][1])
    rasteriseLine(damMask, width, height, c0, r0, c1, r1, bufPx)
  }

  // Dam crest elevation: median of rasterised dam pixels
  const damElevs = []
  for (let i = 0; i < damMask.length; i++) {
    if (damMask[i]) {
      const e = data[i]
      if (!isNaN(e)) damElevs.push(e)
    }
  }
  damElevs.sort((a, b) => a - b)
  const damCrestElev = damElevs.length
    ? damElevs[Math.floor(damElevs.length / 2)]
    : waterLevel

  // ---- 2. BFS flood fill ----
  const floodMask = new Uint8Array(width * height)

  let [seedRow, seedCol] = lonLatToPixel(dem, seedLon, seedLat)
  const seedIdx = seedRow * width + seedCol
  if (damMask[seedIdx] || isNaN(data[seedIdx]) || data[seedIdx] > waterLevel) {
    const found = nearestValidSeed(dem, damMask, seedRow, seedCol, waterLevel)
    if (!found) return { imageDataURL: null, area_km2: 0, volume_m3: 0, damCrestElev }
    ;[seedRow, seedCol] = found
  }

  // Use a typed-array ring buffer for the BFS queue (faster than Array.push/shift)
  const maxQueue = width * height
  const qRows    = new Int32Array(maxQueue)
  const qCols    = new Int32Array(maxQueue)
  let   head = 0, tail = 0

  qRows[tail] = seedRow; qCols[tail] = seedCol; tail++
  floodMask[seedRow * width + seedCol] = 1

  const DR = [-1, 1,  0, 0, -1, -1,  1, 1]
  const DC = [ 0, 0, -1, 1, -1,  1, -1, 1]

  let hitsBoundary = false

  while (head < tail) {
    const r = qRows[head], c = qCols[head]; head++

    // If a flooded cell touches the DEM edge the reservoir likely extends further
    if (r === 0 || r === height - 1 || c === 0 || c === width - 1) {
      hitsBoundary = true
    }

    for (let d = 0; d < 8; d++) {
      const nr = r + DR[d], nc = c + DC[d]
      if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
      const idx = nr * width + nc
      if (floodMask[idx] || damMask[idx]) continue
      const e = data[idx]
      if (isNaN(e) || e > waterLevel) continue
      floodMask[idx] = 1
      qRows[tail] = nr; qCols[tail] = nc; tail++
    }
  }

  // ---- 3. Render to canvas ----
  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height
  const ctx     = canvas.getContext('2d')
  const imgData = ctx.createImageData(width, height)
  const px      = imgData.data

  // Compute once — calling demMin inside the loop would scan the full DEM per pixel
  const minElev = demMin(dem)
  const maxD    = Math.max(1, waterLevel - minElev)

  for (let i = 0; i < width * height; i++) {
    if (!floodMask[i]) continue
    const p = i * 4
    // Depth-tinted blue: deeper → darker
    const depth = Math.max(0, waterLevel - data[i])
    const t     = Math.min(1, depth / maxD)
    px[p]     = Math.round(30  + (1 - t) * 80)   // R
    px[p + 1] = Math.round(100 + (1 - t) * 60)   // G
    px[p + 2] = Math.round(200 + (1 - t) * 55)   // B
    px[p + 3] = Math.round(160 + t * 60)          // A
  }
  ctx.putImageData(imgData, 0, 0)

  // ---- 4. Area & volume ----
  let area_m2 = 0, volume_m3 = 0
  const ph_m = dem.pixelHeightDeg * 110_574

  for (let r = 0; r < height; r++) {
    const lat   = dem.bounds.north - (r + 0.5) * dem.pixelHeightDeg
    const pw_m  = dem.pixelWidthDeg * 111_320 * Math.cos(lat * Math.PI / 180)
    const cellA = ph_m * pw_m
    for (let c = 0; c < width; c++) {
      if (!floodMask[r * width + c]) continue
      area_m2   += cellA
      volume_m3 += Math.max(0, waterLevel - data[r * width + c]) * cellA
    }
  }

  return {
    imageDataURL: canvas.toDataURL('image/png'),
    area_km2:   area_m2 / 1e6,
    volume_m3,
    damCrestElev,
    hitsBoundary,
  }
}

function demMin(dem) {
  let min = Infinity
  for (let i = 0; i < dem.data.length; i++) {
    const v = dem.data[i]
    if (!isNaN(v) && v < min) min = v
  }
  return isFinite(min) ? min : 0
}
