/**
 * Render the flooded cells as a depth-shaded PNG, cropped to the reservoir.
 * Because the grid is in Web Mercator pixels, stretching it between its corner
 * lat/lngs with L.imageOverlay lines it up with the basemap exactly.
 */
import { globalPxToLonLat } from './geo.js'

// Shallow → deep
const STOPS = [
  [0.0, [125, 211, 252]],
  [0.35, [56, 152, 236]],
  [1.0, [12, 52, 140]],
]

function depthColor(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i]
      const k = (t - t0) / (t1 - t0)
      return a.map((v, j) => Math.round(v + (b[j] - v) * k))
    }
  }
  return STOPS[STOPS.length - 1][1]
}

/** @returns Promise<{ url, bounds: [[south, west], [north, east]] } | null> */
export async function renderFloodOverlay(grid, sim) {
  if (sim.status !== 'ok' || !sim.flood) return null
  const { r0, r1, c0, c1 } = sim.floodBox
  const w = c1 - c0 + 1, h = r1 - r0 + 1
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(w, h)
  const px = img.data
  const maxDepth = Math.max(1, sim.maxDepth)

  for (let r = 0; r < h; r++) {
    const src = (r0 + r) * grid.width + c0
    for (let c = 0; c < w; c++) {
      const i = src + c
      if (!sim.flood[i]) continue
      const [R, G, B] = depthColor(Math.min(1, (sim.crest - grid.data[i]) / maxDepth))
      const p = (r * w + c) * 4
      px[p] = R; px[p + 1] = G; px[p + 2] = B; px[p + 3] = 215
    }
  }
  ctx.putImageData(img, 0, 0)

  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
  const [west, north] = globalPxToLonLat(grid.x0 + c0, grid.y0 + r0, grid.z)
  const [east, south] = globalPxToLonLat(grid.x0 + c1 + 1, grid.y0 + r1 + 1, grid.z)
  return { url: URL.createObjectURL(blob), bounds: [[south, west], [north, east]] }
}
