import { useState, useEffect, useRef, useCallback } from 'react'
import MapView from './components/MapView'
import SidePanel from './components/SidePanel'
import AboutDialog from './components/AboutDialog'
import { analyzeReservoir } from './lib/analysis'
import { renderFloodOverlay } from './lib/overlay'
import { sourceById, DEFAULT_SOURCE, loadKeys, saveKeys } from './lib/sources'
import styles from './App.module.css'

const SOURCE_STORE = 'baraj.source'
const readStored = (k, fallback) => { try { return localStorage.getItem(k) || fallback } catch { return fallback } }
const writeStored = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

// One tile loader (with its own cache) per dataset + key
const loaders = new Map()
function loaderFor(source, keys) {
  const key = source.keyProvider ? keys[source.keyProvider] : ''
  const id = `${source.id}|${key}`
  if (!loaders.has(id)) loaders.set(id, source.create(keys))
  return loaders.get(id)
}

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
  const [aboutOpen, setAboutOpen] = useState(false)
  const [sourceId, setSourceId] = useState(() => sourceById(readStored(SOURCE_STORE, DEFAULT_SOURCE)).id)
  const [keys, setKeys] = useState(loadKeys)

  const source = sourceById(sourceId)
  const sourceKey = source.keyProvider ? keys[source.keyProvider] || '' : ''
  const needsKey = !!source.keyProvider && !sourceKey

  const runId = useRef(0)
  const regionHint = useRef(null) // { dam, height, sourceId, region } from the last run

  // Re-run the analysis whenever the dam, its settings or the dataset change
  useEffect(() => {
    if (!dam || !(height > 0)) return
    if (needsKey) {
      runId.current++
      setResult(null)
      setOverlay(null)
      setBusy(false)
      return
    }
    const id = ++runId.current
    const timer = setTimeout(async () => {
      setBusy(true)
      setError(null)
      const hint = regionHint.current
      const region =
        hint && hint.dam === dam && hint.sourceId === source.id && height >= hint.height ? hint.region : undefined
      try {
        const out = await analyzeReservoir(
          { dam, height, side, region, tieIn, startZoom: source.startZoom },
          {
            loadTile: loaderFor(source, keys),
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
        regionHint.current = { dam, height, sourceId: source.id, region: out.result.region }
        setResult(out.result)
        setOverlay(img)
      } catch (e) {
        if (id === runId.current) setError(e.message || String(e))
      } finally {
        if (id === runId.current) setBusy(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [dam, height, side, tieIn, sourceId, sourceKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeSource = id => {
    setSourceId(id)
    writeStored(SOURCE_STORE, id)
  }

  const saveKey = (provider, value) => {
    setKeys(k => {
      const next = { ...k }
      if (value) next[provider] = value
      else delete next[provider]
      saveKeys(next)
      return next
    })
  }

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
          <button className={styles['btn-panel-toggle']} onClick={() => setAboutOpen(true)}>About</button>
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

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <div className={styles['app-body']}>
        {!collapsed && (
          <SidePanel
            dam={dam}
            drawing={drawing}
            height={height}
            side={side}
            tieIn={tieIn}
            onTieInChange={setTieIn}
            sourceId={source.id}
            keys={keys}
            needsKey={needsKey}
            onSourceChange={changeSource}
            onSaveKey={saveKey}
            onOpenAbout={() => setAboutOpen(true)}
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
          keys={keys}
        />
      </div>
    </div>
  )
}
