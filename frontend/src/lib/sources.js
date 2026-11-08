/**
 * Terrain datasets the app can use. Each entry describes the data and builds a
 * tile loader (z, x, y) => Promise<Float32Array> for the engine.
 */

import { rgbTileLoader, decodeTerrarium, decodeMapboxRgb } from './terrain.js'
import { planetaryLoader, openTopographyLoader } from './geotiffSources.js'

/** Services that need an API key, and where to get one. */
export const KEY_PROVIDERS = {
  mapbox: {
    label: 'Mapbox access token',
    url: 'https://account.mapbox.com/access-tokens/',
    placeholder: 'pk.…',
  },
  maptiler: {
    label: 'MapTiler API key',
    url: 'https://cloud.maptiler.com/account/keys/',
    placeholder: 'MapTiler key',
  },
  opentopography: {
    label: 'OpenTopography API key',
    url: 'https://portal.opentopography.org/requestService?service=api',
    placeholder: 'OpenTopography key',
  },
}

const ot = (id, demtype, label, info) => ({
  id: `ot-${id}`,
  label: `${label} (OpenTopography)`,
  group: 'key',
  keyProvider: 'opentopography',
  ...info,
  attribution: `${info.attribution} via OpenTopography`,
  create: keys => openTopographyLoader({ demtype, apiKey: keys.opentopography }),
})

export const SOURCES = [
  // ---- No key needed ----
  {
    id: 'terrarium',
    label: 'AWS Terrain Tiles (Terrarium)',
    group: 'free',
    surveyed: 'Mostly 2000 (SRTM)',
    resolution: '~30 m',
    coverage: 'Global',
    kind: 'Mixed sources (SRTM, USGS NED, others)',
    attribution: 'AWS Terrain Tiles (Mapzen / Tilezen)',
    create: () =>
      rgbTileLoader({
        provider: 'AWS Terrain Tiles',
        decode: decodeTerrarium,
        maxZoom: 15,
        urlFor: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
      }),
  },
  {
    id: 'cop30',
    label: 'Copernicus GLO-30',
    group: 'free',
    surveyed: '2011–2015 (TanDEM-X)',
    resolution: '30 m',
    coverage: 'Global',
    kind: 'Surface model: trees and buildings count as ground',
    attribution: 'Copernicus DEM © DLR / Airbus, via Microsoft Planetary Computer',
    create: () => planetaryLoader({ collection: 'cop-dem-glo-30' }),
  },
  {
    id: 'cop90',
    label: 'Copernicus GLO-90',
    group: 'free',
    surveyed: '2011–2015 (TanDEM-X)',
    resolution: '90 m',
    coverage: 'Global',
    kind: 'Surface model, coarser: quick looks at very large reservoirs',
    attribution: 'Copernicus DEM © DLR / Airbus, via Microsoft Planetary Computer',
    create: () => planetaryLoader({ collection: 'cop-dem-glo-90' }),
  },
  {
    id: 'nasadem',
    label: 'NASADEM',
    group: 'free',
    surveyed: '2000 (reprocessed SRTM)',
    resolution: '30 m',
    coverage: '60°N – 56°S',
    kind: 'Cleaned-up SRTM with fewer voids',
    attribution: 'NASADEM (NASA JPL), via Microsoft Planetary Computer',
    create: () => planetaryLoader({ collection: 'nasadem', asset: 'elevation' }),
  },
  {
    id: 'alos',
    label: 'ALOS World 3D (AW3D30)',
    group: 'free',
    surveyed: '2006–2011 (ALOS PRISM)',
    resolution: '30 m',
    coverage: 'Global land',
    kind: 'Surface model from stereo images; often good in steep terrain',
    attribution: 'AW3D30 © JAXA, via Microsoft Planetary Computer',
    create: () => planetaryLoader({ collection: 'alos-dem' }),
  },
  {
    id: '3dep',
    label: 'USGS 3DEP 1/3″',
    group: 'free',
    surveyed: 'Varies, often lidar',
    resolution: '10 m',
    coverage: 'United States only',
    kind: 'Bare-earth model',
    attribution: 'USGS 3D Elevation Program, via Microsoft Planetary Computer',
    startZoom: 13,
    create: () => planetaryLoader({ collection: '3dep-seamless', gsd: 10 }),
  },

  // ---- Needs a free API key ----
  {
    id: 'mapbox',
    label: 'Mapbox Terrain-DEM',
    group: 'key',
    keyProvider: 'mapbox',
    surveyed: 'Mixed',
    resolution: '~30 m (finer in some countries)',
    coverage: 'Global',
    kind: 'Mixed sources, compiled by Mapbox',
    attribution: '© Mapbox',
    create: keys =>
      rgbTileLoader({
        provider: 'Mapbox',
        decode: decodeMapboxRgb,
        maxZoom: 14,
        urlFor: (z, x, y) =>
          `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${z}/${x}/${y}.pngraw?access_token=${encodeURIComponent(keys.mapbox)}`,
      }),
  },
  {
    id: 'maptiler',
    label: 'MapTiler Terrain RGB',
    group: 'key',
    keyProvider: 'maptiler',
    surveyed: 'Mixed',
    resolution: '~30 m (finer in some countries)',
    coverage: 'Global',
    kind: 'Mixed sources, compiled by MapTiler',
    attribution: '© MapTiler',
    create: keys =>
      rgbTileLoader({
        provider: 'MapTiler',
        decode: decodeMapboxRgb,
        maxZoom: 14,
        urlFor: (z, x, y) =>
          `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.webp?key=${encodeURIComponent(keys.maptiler)}`,
      }),
  },
  ot('srtm', 'SRTMGL1', 'SRTM GL1', {
    surveyed: '2000 (SRTM)', resolution: '30 m', coverage: '60°N – 56°S',
    kind: 'Original SRTM, void-filled', attribution: 'NASA SRTM',
  }),
  ot('cop30', 'COP30', 'Copernicus GLO-30', {
    surveyed: '2011–2015 (TanDEM-X)', resolution: '30 m', coverage: 'Global',
    kind: 'Surface model: trees and buildings count as ground', attribution: 'Copernicus DEM © DLR / Airbus',
  }),
  ot('nasadem', 'NASADEM', 'NASADEM', {
    surveyed: '2000 (reprocessed SRTM)', resolution: '30 m', coverage: '60°N – 56°S',
    kind: 'Cleaned-up SRTM with fewer voids', attribution: 'NASADEM (NASA JPL)',
  }),
  ot('aw3d30', 'AW3D30', 'ALOS World 3D', {
    surveyed: '2006–2011 (ALOS PRISM)', resolution: '30 m', coverage: 'Global land',
    kind: 'Surface model from stereo images', attribution: 'AW3D30 © JAXA',
  }),
  ot('eudtm', 'EU_DTM', 'EU DTM', {
    surveyed: 'Recent compilation', resolution: '30 m', coverage: 'Europe only',
    kind: 'Bare-earth model (trees and buildings removed)', attribution: 'EU DTM (OpenGeoHub)',
  }),
]

export const DEFAULT_SOURCE = 'terrarium'
export const sourceById = id => SOURCES.find(s => s.id === id) || SOURCES[0]

// ---- API keys, kept only in this browser ----
const KEY_STORE = 'baraj.apiKeys'

export function loadKeys() {
  try { return JSON.parse(localStorage.getItem(KEY_STORE)) || {} } catch { return {} }
}

export function saveKeys(keys) {
  try { localStorage.setItem(KEY_STORE, JSON.stringify(keys)) } catch { /* storage blocked: keys last this session only */ }
}
