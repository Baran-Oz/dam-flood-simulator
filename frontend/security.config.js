/**
 * Content-Security-Policy and other response headers for the production build.
 *
 * The app keeps users' API keys in localStorage, so the policy pins down
 * exactly which servers the page may contact. Any injected script would be
 * blocked from running, and blocked from sending data anywhere else.
 *
 * Add a host here whenever a new terrain dataset or basemap is added.
 */

const TERRAIN = [
  'https://s3.amazonaws.com',                  // AWS Terrain Tiles (Terrarium)
  'https://planetarycomputer.microsoft.com',   // STAC search + SAS tokens
  'https://*.blob.core.windows.net',           // Planetary Computer GeoTIFFs
  'https://api.mapbox.com',                    // Mapbox Terrain-DEM (+ satellite)
  'https://api.maptiler.com',                  // MapTiler Terrain RGB (+ satellite)
  'https://portal.opentopography.org',         // OpenTopography Global DEM API
]

const BASEMAP_IMAGES = [
  'https://*.tile.opentopomap.org',
  'https://tiles.maps.eox.at',
  'https://api.maptiler.com',
  'https://api.mapbox.com',
]

const BASEMAP_FETCH = ['https://tiles.openfreemap.org'] // vector style, tiles, glyphs, sprites

const directives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", 'https://fonts.googleapis.com'],
  'font-src': ['https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:', ...BASEMAP_IMAGES, ...BASEMAP_FETCH],
  'connect-src': ["'self'", ...TERRAIN, ...BASEMAP_FETCH],
  'worker-src': ["'self'", 'blob:'], // MapLibre runs its workers from blob: URLs
  'child-src': ['blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
}

const serialize = d => Object.entries(d).map(([k, v]) => `${k} ${[...new Set(v)].join(' ')}`).join('; ')

/** For the <meta> tag: frame-ancestors is ignored there, so it's header-only. */
export const cspMeta = serialize(directives)

export const cspHeader = serialize({ ...directives, 'frame-ancestors': ["'none'"] })

/** Cloudflare Pages / Netlify `_headers` file. */
export const headersFile = `/*
  Content-Security-Policy: ${cspHeader}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`

/** Vite plugin: inject the CSP meta tag and emit `_headers` (production builds only). */
export function securityHeaders() {
  return {
    name: 'security-headers',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: cspMeta }, injectTo: 'head-prepend' }]
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile })
    },
  }
}
