import { useState, useEffect, useRef, useCallback } from 'react'
import MapView from './components/MapView'
import SidePanel from './components/SidePanel'
import { analyzeReservoir } from './lib/analysis'
import { createTileLoader } from './lib/terrain'
import { renderFloodOverlay } from './lib/overlay'
import styles from './App.module.css'

const loadTile = createTileLoader()
const LAYERS = [
  { id: 'street', label: 'Street' },
  { id: 'topo', label: 'Topo' },
  { id: 'satellite', label: 'Satellite' },
]

export default function App() {
  const [dam, setDam] = useState(null)            // [[lon, lat], ...]
  const [drawing, setDrawing] = useState(false)
  const [height, setHeight] = useState(60)        // m above riverbed
  const [side, setSide] = useState('auto')        // 'auto' | 1 | -1
  const [tieIn, setTieIn] = useState(true)        // extend axis ends into high ground
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [overlay, setOverlay] = useState(null)
  const [error, setError] = useState(null)
  const [layer, setLayer] = useState('topo')
  const [collapsed, setCollapsed] = useState(false)

  const runId = useRef(0)
  const regionHint = useRef(null) // { dam, height, region } from the last run

  // Re-run the analysis whenever the dam, its height or the upstream side changes
  useEffect(() => {
    if (!dam || !(height > 0)) return
    const id = ++runId.current
    const timer = setTimeout(async () => {
      setBusy(true)
      setError(null)
      const hint = regionHint.current
      const region = hint && hint.dam === dam && height >= hint.height ? hint.region : undefined
      try {
        const out = await analyzeReservoir(
          { dam, height, side, region, tieIn },
          {
            loadTile,
            onProgress: msg => id === runId.current && setProgress(msg),
            isCancelled: () => id !== runId.current,
          },
        )
        if (!out || id !== runId.current) return
        const img = await renderFloodOverlay(out.grid, out.sim)
        if (id !== runId.current) {
          if (img) URL.revokeObjectURL(img.url)
          return
        }
        regionHint.current = { dam, height, region: out.result.region }
        setResult(out.result)
        setOverlay(img)
      } catch (e) {
        if (id === runId.current) setError(e.message || String(e))
      } finally {
        if (id === runId.current) setBusy(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [dam, height, side, tieIn])

  // Release the previous overlay image when it is replaced
  useEffect(() => () => overlay && URL.revokeObjectURL(overlay.url), [overlay])

  const clearResults = () => {
    runId.current++
    setResult(null)
    setOverlay(null)
    setError(null)
    setBusy(false)
  }

  const handleDamDrawn = useCallback(coords => {
    clearResults()
    setDrawing(false)
    setSide('auto')
    setDam(coords)
  }, [])

  const startDrawing = () => {
    clearResults()
    setDam(null)
    setDrawing(true)
  }

  const reset = () => {
    clearResults()
    setDam(null)
    setDrawing(false)
    setSide('auto')
  }

  const flipSide = () => result && setSide(-result.side)

  return (
    <div className={styles['app-layout']}>
      <header className={styles['app-header']}>
        <div className={styles['header-left']}>
          <svg className={styles['app-logo']} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 20h18M5 20V9l4-2v13M9 20V7l10 3v10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M11 14c1.5-1 3-1 4.5 0s3 1 3.5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <div className={styles['header-titles']}>
            <span className={styles['app-title']}>Dam Flood Simulator</span>
            <span className={styles['app-subtitle']}>Reservoir inundation from terrain</span>
          </div>
        </div>

        <div className={styles['header-center']}>
          <div className={styles['layer-toggle']} role="group" aria-label="Basemap">
            {LAYERS.map(l => (
              <button
                key={l.id}
                className={`${styles['toggle-btn']} ${layer === l.id ? styles['toggle-active'] : ''}`}
                onClick={() => setLayer(l.id)}
                aria-pressed={layer === l.id}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles['header-right']}>
          {(dam || drawing) && (
            <button className={styles['btn-reset']} onClick={reset}>Reset</button>
          )}
          <button
            className={styles['btn-panel-toggle']}
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Show panel' : 'Hide panel'}
            aria-label={collapsed ? 'Show panel' : 'Hide panel'}
          >
            {collapsed ? '☰' : '✕'}
          </button>
        </div>
      </header>

      <div className={styles['app-body']}>
        {!collapsed && (
          <SidePanel
            dam={dam}
            drawing={drawing}
            height={height}
            side={side}
            tieIn={tieIn}
            onTieInChange={setTieIn}
            busy={busy}
            progress={progress}
            result={result}
            error={error}
            onStartDrawing={startDrawing}
            onCancelDrawing={() => setDrawing(false)}
            onHeightChange={setHeight}
            onFlipSide={flipSide}
            onAutoSide={() => setSide('auto')}
          />
        )}

        <MapView
          dam={dam}
          drawing={drawing}
          onDamDrawn={handleDamDrawn}
          onDrawCancelled={() => setDrawing(false)}
          overlay={overlay}
          upstreamPoint={result?.upstreamPoint}
          axis={result?.axis}
          gridBounds={result?.edgeLimited ? result.gridBounds : null}
          leak={!!result?.leak}
          layer={layer}
        />
      </div>
    </div>
  )
}
