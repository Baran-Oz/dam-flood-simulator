/**
 * MapView: Leaflet map with
 *  - polyline drawing for the dam axis (started from the side panel)
 *  - the dam axis, an upstream marker and the depth-shaded flood overlay
 */
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'
import { createBasemap, satelliteProvider } from '../lib/basemaps'
import styles from './MapView.module.css'

const DAM_COLOR = '#f59e0b'

export default function MapView({
  dam, drawing, onDamDrawn, onDrawCancelled, overlay, upstreamPoint, axis, gridBounds, leak, layer, keys,
}) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const baseRef = useRef(null)
  const damRef = useRef(null)
  const upRef = useRef(null)
  const floodRef = useRef(null)
  const extRef = useRef(null)
  const limitRef = useRef(null)
  const drawRef = useRef(null)
  const fittedFor = useRef(null)
  const stoppingRef = useRef(false) // true while we disable the draw handler ourselves
  const cbRef = useRef({ onDamDrawn, onDrawCancelled })
  cbRef.current = { onDamDrawn, onDrawCancelled }

  // ---- init once ----
  useEffect(() => {
    const map = L.map(divRef.current, { center: [39, 35], zoom: 6, zoomControl: false })
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map)

    let created = false
    map.on(L.Draw.Event.CREATED, e => {
      created = true
      const coords = e.layer.getLatLngs().map(ll => [ll.lng, ll.lat])
      if (coords.length >= 2) cbRef.current.onDamDrawn(coords)
      else cbRef.current.onDrawCancelled()
    })
    map.on(L.Draw.Event.DRAWSTART, () => { created = false })
    map.on(L.Draw.Event.DRAWSTOP, () => {
      // DRAWSTOP fires after CREATED; only treat it as a cancel when nothing was made
      if (stoppingRef.current) return
      setTimeout(() => { if (!created) cbRef.current.onDrawCancelled() }, 0)
    })

    mapRef.current = map
    // Handle for scripted browser checks (dev server, or a test build with VITE_EXPOSE_MAP=1)
    if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_MAP) window.__damMap = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // ---- basemap (satellite imagery depends on which keys are saved) ----
  const satKey = layer === 'satellite' ? satelliteProvider(keys) : ''
  const satToken = satKey === 'maptiler' ? keys?.maptiler : satKey === 'mapbox' ? keys?.mapbox : ''
  useEffect(() => {
    const map = mapRef.current
    let cancelled = false
    createBasemap(layer, keys)
      .then(base => {
        if (cancelled || !mapRef.current) return
        if (baseRef.current) baseRef.current.remove()
        baseRef.current = base.addTo(map)
        base.bringToBack?.()
      })
      .catch(err => console.error('Basemap failed to load', err))
    return () => { cancelled = true }
  }, [layer, satKey, satToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- drawing mode ----
  useEffect(() => {
    const map = mapRef.current
    if (drawing) {
      drawRef.current = new L.Draw.Polyline(map, {
        shapeOptions: { color: DAM_COLOR, weight: 5, opacity: 0.95 },
        showLength: true,
        metric: true,
        feet: false,
      })
      drawRef.current.enable()
    }
    return () => {
      if (drawRef.current) {
        stoppingRef.current = true
        drawRef.current.disable()
        stoppingRef.current = false
        drawRef.current = null
      }
    }
  }, [drawing])

  // ---- dam axis ----
  useEffect(() => {
    const map = mapRef.current
    if (damRef.current) { damRef.current.remove(); damRef.current = null }
    if (!dam) return
    damRef.current = L.polyline(dam.map(([lon, lat]) => [lat, lon]), {
      color: leak ? '#ef4444' : DAM_COLOR,
      weight: 6,
      opacity: 1,
      lineCap: 'square',
    }).addTo(map)
  }, [dam, leak])

  // ---- tie-in extensions of the axis (dashed) ----
  useEffect(() => {
    const map = mapRef.current
    if (extRef.current) { extRef.current.remove(); extRef.current = null }
    if (!dam || !axis || axis.length <= dam.length) return
    const ll = ([lon, lat]) => [lat, lon]
    const same = (a, b) => a[0] === b[0] && a[1] === b[1]
    const parts = []
    if (!same(axis[0], dam[0])) parts.push([ll(axis[0]), ll(dam[0])])
    const a = axis[axis.length - 1], d = dam[dam.length - 1]
    if (!same(a, d)) parts.push([ll(d), ll(a)])
    extRef.current = L.polyline(parts, {
      color: leak ? '#ef4444' : DAM_COLOR, weight: 4, opacity: 0.9, dashArray: '6 6',
    })
      .bindTooltip('Dam extended into the valley side', { sticky: true })
      .addTo(map)
  }, [dam, axis, leak])

  // ---- loaded-terrain boundary, shown only when the flood stops at it ----
  useEffect(() => {
    const map = mapRef.current
    if (limitRef.current) { limitRef.current.remove(); limitRef.current = null }
    if (!gridBounds) return
    limitRef.current = L.rectangle(gridBounds, {
      color: '#fbbf24', weight: 2, dashArray: '8 6', fill: false, interactive: false,
    }).addTo(map)
  }, [gridBounds])

  // ---- upstream marker ----
  useEffect(() => {
    const map = mapRef.current
    if (upRef.current) { upRef.current.remove(); upRef.current = null }
    if (!upstreamPoint || !dam) return
    upRef.current = L.circleMarker([upstreamPoint[1], upstreamPoint[0]], {
      radius: 6, color: '#fff', weight: 2, fillColor: '#0ea5e9', fillOpacity: 1,
    })
      .bindTooltip('Upstream (reservoir side)', { direction: 'top', offset: [0, -6] })
      .addTo(map)
  }, [upstreamPoint, dam])

  // ---- flood overlay (+ zoom to it once per dam) ----
  useEffect(() => {
    const map = mapRef.current
    if (floodRef.current) { floodRef.current.remove(); floodRef.current = null }
    if (!overlay) return
    floodRef.current = L.imageOverlay(overlay.url, overlay.bounds, { opacity: 0.85, interactive: false }).addTo(map)
    if (fittedFor.current !== dam) {
      fittedFor.current = dam
      map.flyToBounds(L.latLngBounds(overlay.bounds).pad(0.15), { maxZoom: 14, duration: 0.8 })
    }
  }, [overlay, dam])

  return (
    <div className={styles['map-wrapper']}>
      <div ref={divRef} className={`${styles['map-container']} ${drawing ? styles.drawing : ''}`} />
      {drawing && (
        <div className={styles['map-hint']}>
          Click across the valley from one bank to the other · click the last point again to finish · Esc to cancel
        </div>
      )}
    </div>
  )
}
