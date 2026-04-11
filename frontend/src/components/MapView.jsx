/**
 * MapView — interactive Leaflet map.
 *
 * Provides:
 *  - Polyline draw tool (leaflet-draw) for the dam wall
 *  - Click-to-place reservoir seed point
 *  - L.ImageOverlay for the raster flood mask (rendered by floodSim.js)
 */
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'
import './MapView.css'

// Fix Leaflet default icon URLs broken by Vite bundling
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export default function MapView({ step, simResult, onDamDrawn, onSeedPlaced }) {
  const divRef          = useRef(null)
  const mapRef          = useRef(null)
  const drawnItemsRef   = useRef(null)
  const seedMarkerRef   = useRef(null)
  const floodOverlayRef = useRef(null)

  // -----------------------------------------------------------------------
  // Init map once
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(divRef.current, { center: [39, 35], zoom: 7 })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    const drawnItems = new L.FeatureGroup().addTo(map)
    drawnItemsRef.current = drawnItems

    const drawCtrl = new L.Control.Draw({
      edit: { featureGroup: drawnItems, edit: false, remove: false },
      draw: {
        polyline:    { shapeOptions: { color: '#f59e0b', weight: 4 } },
        polygon:     false,
        rectangle:   false,
        circle:      false,
        marker:      false,
        circlemarker: false,
      },
    })
    map.addControl(drawCtrl)

    // e.layer is the correct leaflet-draw CREATED event property
    // (the TS deprecation hint is a false alarm from Leaflet's base event types)
    map.on(L.Draw.Event.CREATED, (e) => {
      const drawn = /** @type {any} */ (e).layer
      drawnItems.clearLayers()
      drawnItems.addLayer(drawn)
      const coords = drawn.getLatLngs().map(ll => [ll.lng, ll.lat])
      onDamDrawnRef.current(coords)
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref for onDamDrawn callback (avoids reinitialising the map)
  const onDamDrawnRef = useRef(onDamDrawn)
  useEffect(() => { onDamDrawnRef.current = onDamDrawn }, [onDamDrawn])

  // -----------------------------------------------------------------------
  // Seed-point click handler — only active during 'seed' step
  // -----------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handler = (e) => {
      if (step !== 'seed') return
      const { lat, lng } = e.latlng

      if (seedMarkerRef.current) seedMarkerRef.current.remove()
      seedMarkerRef.current = L.circleMarker([lat, lng], {
        radius: 9, color: '#22d3ee', fillColor: '#06b6d4', fillOpacity: 0.9, weight: 2,
      }).addTo(map).bindTooltip('Reservoir seed', { permanent: false }).openTooltip()

      onSeedPlaced([lng, lat])
    }

    map.on('click', handler)
    return () => map.off('click', handler)
  }, [step, onSeedPlaced])

  // -----------------------------------------------------------------------
  // Update flood image overlay
  // -----------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove old overlay
    if (floodOverlayRef.current) {
      floodOverlayRef.current.remove()
      floodOverlayRef.current = null
    }

    if (!simResult?.imageDataURL || !simResult?.bounds) return

    const { west, east, north, south } = simResult.bounds
    const bounds = [[south, west], [north, east]]

    const overlay = L.imageOverlay(simResult.imageDataURL, bounds, {
      opacity:     1,
      interactive: false,
    }).addTo(map)

    floodOverlayRef.current = overlay
  }, [simResult])

  // -----------------------------------------------------------------------
  // Cursor
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (divRef.current)
      divRef.current.style.cursor = step === 'seed' ? 'crosshair' : ''
  }, [step])

  return (
    <div className="map-wrapper">
      <div ref={divRef} className="map-container" />
      {step === 'seed' && (
        <div className="map-overlay-hint">
          Click on the upstream (reservoir) side of the dam
        </div>
      )}
      {step === 'fetching' && (
        <div className="map-overlay-hint map-overlay-loading">
          Downloading elevation data…
        </div>
      )}
    </div>
  )
}
