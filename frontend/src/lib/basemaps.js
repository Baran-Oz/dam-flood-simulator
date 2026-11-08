/**
 * Basemaps whose terms allow use in a public web app.
 *
 *  - Street: OpenFreeMap vector tiles (free, no key, commercial use allowed),
 *    rendered with MapLibre and loaded only when first selected.
 *  - Topo: OpenTopoMap (free, best-effort service for light use).
 *  - Satellite: MapTiler or Mapbox imagery when the user has saved that key,
 *    otherwise EOX Sentinel-2 cloudless 2016 (CC BY 4.0, ~10 m).
 */
import L from 'leaflet'

const OSM = '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/** Which satellite imagery a given set of saved keys gives you. */
export function satelliteProvider(keys = {}) {
  if (keys.maptiler) return 'maptiler'
  if (keys.mapbox) return 'mapbox'
  return 'eox'
}

export const SATELLITE_LABEL = {
  maptiler: 'MapTiler Satellite',
  mapbox: 'Mapbox Satellite',
  eox: 'Sentinel-2 cloudless 2016 (EOX)',
}

/** @returns Promise<L.Layer> */
export async function createBasemap(id, keys = {}) {
  if (id === 'street') {
    const [{ maplibreGL }, maplibre, worker] = await Promise.all([
      import('@maplibre/maplibre-gl-leaflet'),
      import('maplibre-gl'),
      // MapLibre computes its worker URL at runtime, which bundlers can't see;
      // let Vite bundle the worker and tell MapLibre where it is.
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ])
    maplibre.setWorkerUrl(worker.default)
    return maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/liberty',
      attribution: `<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from ${OSM}`,
    })
  }

  if (id === 'topo') {
    return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: `Map data: ${OSM}, SRTM | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
      maxZoom: 17,
    })
  }

  // satellite
  const provider = satelliteProvider(keys)
  if (provider === 'maptiler') {
    return L.tileLayer(`https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key=${encodeURIComponent(keys.maptiler)}`, {
      attribution: `<a href="https://www.maptiler.com/copyright/">© MapTiler</a> © ${OSM}`,
      maxZoom: 20,
    })
  }
  if (provider === 'mapbox') {
    return L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}?access_token=${encodeURIComponent(keys.mapbox)}`, {
      attribution: `© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © ${OSM}`,
      maxZoom: 20,
    })
  }
  return L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg', {
    attribution:
      '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016 &amp; 2017)',
    maxNativeZoom: 14,
    maxZoom: 19,
  })
}
