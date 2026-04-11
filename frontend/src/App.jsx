import { useState, useCallback, useRef } from 'react'
import MapView from './components/MapView'
import StatsPanel from './components/StatsPanel'
import Toolbar from './components/Toolbar'
import { fetchDEM, elevationRange, sampleElevation } from './lib/demTiles'
import { simulate } from './lib/floodSim'
import './App.css'

/**
 * Workflow steps:
 *  idle     – waiting for user to draw dam wall
 *  seed     – dam drawn; waiting for seed click on reservoir side
 *  fetching – downloading DEM tiles
 *  ready    – DEM loaded; simulation running on slider change
 *  error    – something went wrong
 */

export default function App() {
  const [step,       setStep]       = useState('idle')
  const [damCoords,  setDamCoords]  = useState(null)
  const [seedPoint,  setSeedPoint]  = useState(null)
  const [dem,        setDem]        = useState(null)
  const [elevRange,  setElevRange]  = useState({ min: 0, max: 100 })
  const [waterLevel, setWaterLevel] = useState(0)
  const [simResult,  setSimResult]  = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [damCrest,   setDamCrest]   = useState(null)

  const debounceRef = useRef(null)

  // -------------------------------------------------------------------
  // Step 1: dam wall drawn on map
  // -------------------------------------------------------------------
  const handleDamDrawn = useCallback((coords) => {
    setDamCoords(coords)
    setSimResult(null)
    setStep('seed')
  }, [])

  // -------------------------------------------------------------------
  // Step 2: user clicks seed point → fetch DEM
  // -------------------------------------------------------------------
  const handleSeedPlaced = useCallback(async (lnglat) => {
    if (!damCoords) return
    setSeedPoint(lnglat)
    setStep('fetching')
    setLoading(true)
    setError(null)

    // Bounding box: convex hull of dam + seed + generous padding.
    // 0.5° ≈ 40–55 km, enough to capture a typical reservoir upstream valley.
    // chooseZoom() in demTiles.js will automatically pick a coarser resolution
    // (zoom 11, ~80 m/px) for areas this large, keeping tile count manageable.
    const allLon = [...damCoords.map(c => c[0]), lnglat[0]]
    const allLat = [...damCoords.map(c => c[1]), lnglat[1]]
    const pad  = 0.5
    const bbox = {
      west:  Math.max(-180, Math.min(...allLon) - pad),
      east:  Math.min( 180, Math.max(...allLon) + pad),
      south: Math.max( -90, Math.min(...allLat) - pad),
      north: Math.min(  90, Math.max(...allLat) + pad),
    }

    try {
      const demData = await fetchDEM(bbox.west, bbox.south, bbox.east, bbox.north)
      const range   = elevationRange(demData)
      setDem(demData)
      setElevRange(range)

      // Default water level: dam base + 10 m (or midpoint of range)
      const midIdx      = Math.floor(damCoords.length / 2)
      const damBaseElev = sampleElevation(demData, damCoords[midIdx][0], damCoords[midIdx][1])
      const defaultLevel = isNaN(damBaseElev)
        ? range.min + (range.max - range.min) * 0.2
        : Math.min(damBaseElev + 10, range.max)

      setWaterLevel(defaultLevel)
      setStep('ready')

      // Hand loading control to runSim — it will set loading=false after the sim
      runSim(demData, damCoords, defaultLevel, lnglat)
    } catch (e) {
      setError(e.message)
      setStep('error')
      setLoading(false)   // only on error; success path lets runSim own loading state
    }
  }, [damCoords])  // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------
  const runSim = useCallback((demArg, damArg, level, seedArg) => {
    const useDem  = demArg  ?? dem
    const useDam  = damArg  ?? damCoords
    const useSeed = seedArg ?? seedPoint
    if (!useDem || !useDam || !useSeed) return

    setLoading(true)
    // Run on the next tick so the UI can re-render the loading state first
    setTimeout(() => {
      try {
        const result = simulate(useDem, useDam, level, useSeed[0], useSeed[1])
        setSimResult({
          imageDataURL:  result.imageDataURL,
          bounds:        useDem.bounds,
          area_km2:      result.area_km2,
          volume_m3:     result.volume_m3,
          hitsBoundary:  result.hitsBoundary,
        })
        setDamCrest(result.damCrestElev)
        setError(null)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }, 0)
  }, [dem, damCoords, seedPoint])

  // Debounced slider handler (150 ms)
  const handleWaterLevelChange = useCallback((level) => {
    setWaterLevel(level)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSim(null, null, level, null), 150)
  }, [runSim])

  // -------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------
  const handleReset = useCallback(() => {
    setStep('idle')
    setDamCoords(null)
    setSeedPoint(null)
    setDem(null)
    setSimResult(null)
    setError(null)
    setWaterLevel(0)
    setDamCrest(null)
  }, [])

  return (
    <div className="app-layout">
      <header className="app-header">
        <span className="app-title">Dam Flood Simulator</span>
        {step !== 'idle' && (
          <button className="btn-reset" onClick={handleReset}>Reset</button>
        )}
      </header>

      <div className="app-body">
        <Toolbar
          step={step}
          loading={loading}
          error={error}
          elevRange={elevRange}
          waterLevel={waterLevel}
          damCrest={damCrest}
          onWaterLevelChange={handleWaterLevelChange}
        />

        <MapView
          step={step}
          simResult={simResult}
          onDamDrawn={handleDamDrawn}
          onSeedPlaced={handleSeedPlaced}
        />

        <StatsPanel
          step={step}
          loading={loading}
          simResult={simResult}
          waterLevel={waterLevel}
          damCrest={damCrest}
        />
      </div>
    </div>
  )
}
