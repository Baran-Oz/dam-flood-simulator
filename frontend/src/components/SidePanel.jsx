import { useRef } from 'react'
import { polylineLength } from '../lib/geo'
import DamProfile from './DamProfile'
import TerrainPicker from './TerrainPicker'
import { sourceById } from '../lib/sources'
import styles from './SidePanel.module.css'

const fmtNum = (v, d = 0) =>
  Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—'

function fmtArea(m2) {
  const km2 = m2 / 1e6
  if (km2 >= 100) return [fmtNum(km2, 0), 'km²']
  if (km2 >= 1) return [fmtNum(km2, 2), 'km²']
  return [fmtNum(m2 / 1e4, 1), 'ha']
}

function fmtVolume(m3) {
  if (m3 >= 1e9) return [fmtNum(m3 / 1e9, 2), 'km³']
  if (m3 >= 1e6) return [fmtNum(m3 / 1e6, m3 >= 1e8 ? 0 : 1), 'million m³']
  return [fmtNum(m3, 0), 'm³']
}

const fmtLen = m => (m >= 1000 ? `${fmtNum(m / 1000, 2)} km` : `${fmtNum(m, 0)} m`)

/**
 * Settings and results. On desktop a floating panel on the left; on phones a bottom
 * sheet that shows only the current step ("peek") until it is expanded.
 */
export default function SidePanel(props) {
  const { mobile, expanded, onToggleExpanded, panelRef } = props
  const peek = mobile && !expanded

  return (
    <aside
      ref={panelRef}
      className={`${styles.panel} ${mobile ? styles.sheet : ''} ${peek ? styles.peek : ''}`}
      aria-label="Dam settings and results"
    >
      {mobile && <SheetHandle expanded={expanded} onToggle={onToggleExpanded} />}
      {peek ? <PeekContent {...props} /> : <FullContent {...props} />}
    </aside>
  )
}

/** Grab bar of the bottom sheet: tap to toggle, or swipe up / down */
function SheetHandle({ expanded, onToggle }) {
  const startY = useRef(null)
  const swiped = useRef(false)
  return (
    <button
      type="button"
      className={styles.handle}
      onPointerDown={e => { startY.current = e.clientY; swiped.current = false }}
      onPointerUp={e => {
        if (startY.current === null) return
        const dy = e.clientY - startY.current
        startY.current = null
        if (Math.abs(dy) < 24) return // a tap: handled by onClick
        swiped.current = true
        if ((dy < 0) !== expanded) onToggle()
      }}
      onClick={() => {
        if (swiped.current) swiped.current = false
        else onToggle()
      }}
      aria-expanded={expanded}
    >
      <span className={styles.grip} aria-hidden="true" />
      <span className={styles.handleLabel}>{expanded ? 'Show less' : 'Settings & details'}</span>
    </button>
  )
}

function DrawingControls({ touch, vertexCount, onCancelDrawing, onUndoPoint, onFinishDrawing }) {
  return (
    <div className={styles.drawBtns}>
      <button className={styles.secondary} onClick={onUndoPoint} disabled={vertexCount < 2}>Undo point</button>
      <button className={styles.secondary} onClick={onCancelDrawing}>Cancel</button>
      <button
        className={`${styles.primary} ${styles.finish}`}
        onClick={onFinishDrawing}
        disabled={vertexCount < 2}
        title={vertexCount < 2 ? `${touch ? 'Tap' : 'Click'} at least two points first` : undefined}
      >
        Finish
      </button>
    </div>
  )
}

function HeightControl({ dam, height, onHeightChange }) {
  return (
    <div className={styles.heightRow}>
      <input
        type="range"
        className={styles.slider}
        min="1" max="300" step="1"
        value={Math.min(300, height)}
        onChange={e => onHeightChange(+e.target.value)}
        disabled={!dam}
        aria-label="Dam height slider"
      />
      <label className={styles.numberBox}>
        <input
          type="number"
          inputMode="numeric"
          min="1" max="1000" step="1"
          value={height}
          onChange={e => onHeightChange(Math.max(0, +e.target.value))}
          disabled={!dam}
          aria-label="Dam height in metres"
        />
        <span>m</span>
      </label>
    </div>
  )
}

function Headline({ result }) {
  return (
    <div className={styles.headline}>
      <Stat label="Flooded area" value={fmtArea(result.area_m2)} big />
      <Stat label="Water volume" value={fmtVolume(result.volume_m3)} big />
    </div>
  )
}

/** Compact sheet content: only what the current step needs, so the map stays visible */
function PeekContent({
  dam, drawing, height, busy, progress, result, error, needsKey, touch, vertexCount,
  onStartDrawing, onCancelDrawing, onUndoPoint, onFinishDrawing, onHeightChange, onToggleExpanded,
}) {
  if (drawing) {
    return (
      <div className={styles.peekBody}>
        <p className={styles.hint}>
          {touch ? 'Tap' : 'Click'} points across the valley, from one bank to the other and up both slopes.{' '}
          {vertexCount > 0 && <strong>{vertexCount} {vertexCount === 1 ? 'point' : 'points'}</strong>}
        </p>
        <DrawingControls {...{ touch, vertexCount, onCancelDrawing, onUndoPoint, onFinishDrawing }} />
      </div>
    )
  }

  if (!dam) {
    return (
      <div className={styles.peekBody}>
        <p className={styles.hint}>Zoom in to a river valley and draw the dam's axis across it.</p>
        <button className={styles.primary} onClick={onStartDrawing}>Draw dam axis</button>
      </div>
    )
  }

  const ok = result?.status === 'ok'
  let summary
  if (needsKey) {
    summary = (
      <button type="button" className={`${styles.callout} ${styles.calloutBtn}`} onClick={onToggleExpanded}>
        Add an API key for this dataset to run the analysis. <u>Open settings</u>
      </button>
    )
  } else if (error) {
    summary = <div className={`${styles.callout} ${styles.danger}`}>{error}</div>
  } else if (result) {
    const problem = result.leak
      ? "The dam doesn't seal the valley at this height."
      : result.status === 'nodata'
        ? 'No terrain data under the dam axis.'
        : !ok ? 'No water is held at this height.' : null
    summary = (
      <div className={busy ? styles.stale : ''}>
        {problem ? (
          <button
            type="button"
            className={`${styles.callout} ${styles.calloutBtn} ${result.leak || result.status === 'nodata' ? styles.danger : ''}`}
            onClick={onToggleExpanded}
          >
            {problem} <u>Details</u>
          </button>
        ) : (
          <Headline result={result} />
        )}
      </div>
    )
  } else if (busy) {
    summary = <p className={styles.progress}>{progress || 'Starting…'}</p>
  }

  return (
    <div className={styles.peekBody}>
      {summary}
      <div className={styles.peekHeight}>
        <span className={styles.peekLabel}>
          Dam height
          {busy && <span className={styles.spinner} aria-label="Computing" />}
        </span>
        <HeightControl {...{ dam, height, onHeightChange }} />
      </div>
    </div>
  )
}

function FullContent({
  dam, drawing, height, side, tieIn, busy, progress, result, error, touch, vertexCount,
  sourceId, keys, needsKey, onSourceChange, onSaveKey, onOpenAbout,
  onStartDrawing, onCancelDrawing, onUndoPoint, onFinishDrawing, onHeightChange, onFlipSide, onAutoSide, onTieInChange,
}) {
  const damLength = dam ? polylineLength(dam) : 0
  const ok = result?.status === 'ok'
  const verb = touch ? 'Tap' : 'Click'

  return (
    <>
      {/* ---------- 1. Dam axis ---------- */}
      <section className={styles.section}>
        <h2 className={styles.heading}><span className={styles.num}>1</span>Dam axis</h2>
        {drawing ? (
          <>
            <p className={styles.hint}>
              {verb} points across the valley, from one bank to the other. Carry the line up
              both slopes, beyond where the water will reach. {verb} the last point again, or
              press Finish.
            </p>
            <DrawingControls {...{ touch, vertexCount, onCancelDrawing, onUndoPoint, onFinishDrawing }} />
          </>
        ) : dam ? (
          <div className={styles.row}>
            <span className={styles.kv}>Length <strong>{fmtLen(damLength)}</strong></span>
            <button className={styles.secondary} onClick={onStartDrawing}>Redraw</button>
          </div>
        ) : (
          <>
            <p className={styles.hint}>
              Zoom in to a river valley and draw the dam's axis across it.
            </p>
            <button className={styles.primary} onClick={onStartDrawing}>Draw dam axis</button>
          </>
        )}
      </section>

      {/* ---------- 2. Height ---------- */}
      <section className={`${styles.section} ${!dam ? styles.disabled : ''}`}>
        <h2 className={styles.heading}><span className={styles.num}>2</span>Dam height</h2>
        <HeightControl {...{ dam, height, onHeightChange }} />
        <p className={styles.note}>
          Measured from the riverbed (lowest ground on the axis). The reservoir fills to the crest.
        </p>
        <label className={styles.check}>
          <input type="checkbox" checked={tieIn} onChange={e => onTieInChange(e.target.checked)} disabled={!dam} />
          <span>Extend the dam ends into the valley sides, up to ground above the crest</span>
        </label>
      </section>

      {/* ---------- 3. Terrain data ---------- */}
      <section className={styles.section}>
        <h2 className={styles.heading}><span className={styles.num}>3</span>Terrain data</h2>
        <TerrainPicker sourceId={sourceId} keys={keys} onSourceChange={onSourceChange} onSaveKey={onSaveKey} />
      </section>

      {/* ---------- 4. Results ---------- */}
      {dam && (
        <section className={styles.section}>
          <h2 className={styles.heading}>
            <span className={styles.num}>4</span>Reservoir
            {busy && <span className={styles.spinner} aria-label="Computing" />}
          </h2>

          {needsKey && (
            <div className={styles.callout}>Add an API key for this dataset (section 3) to run the analysis.</div>
          )}
          {busy && !result && <p className={styles.progress}>{progress || 'Starting…'}</p>}
          {busy && result && <p className={styles.progress}>{progress}</p>}
          {error && <div className={`${styles.callout} ${styles.danger}`}>{error}</div>}

          {result && !needsKey && (
            <div className={busy ? styles.stale : ''}>
              {ok && !result.leak && <Headline result={result} />}

              {result.status !== 'nodata' && <dl className={styles.facts}>
                <Fact k="Crest / water level" v={`${fmtNum(result.crest, 1)} m`} />
                {result.crestLength - result.damLength > 1 && (
                  <Fact k="Crest length (with extensions)" v={fmtLen(result.crestLength)} />
                )}
                <Fact k="Riverbed at dam" v={`${fmtNum(result.base, 1)} m`} />
                {ok && !result.leak && <Fact k="Max depth" v={`${fmtNum(result.maxDepth, 1)} m`} />}
                {ok && !result.leak && <Fact k="Mean depth" v={`${fmtNum(result.meanDepth, 1)} m`} />}
                <Fact k="Terrain resolution" v={`~${fmtNum(result.resolution, 0)} m`} />
              </dl>}

              <Warnings result={result} />

              <div className={styles.sideRow}>
                <span className={styles.kv}>
                  Upstream side: <strong>{side === 'auto' ? 'auto-detected' : 'set manually'}</strong>
                </span>
                <div className={styles.sideBtns}>
                  {side !== 'auto' && (
                    <button className={styles.link} onClick={onAutoSide}>Auto</button>
                  )}
                  <button className={styles.secondary} onClick={onFlipSide}>Flip side</button>
                </div>
              </div>

              <DamProfile profile={result.profile} crest={result.crest} base={result.base} />
            </div>
          )}
        </section>
      )}

      <footer className={styles.footer}>
        Terrain: {sourceById(sourceId).attribution}. Elevations are of the surface at the time of
        survey, so lakes that already existed then count as land.{' '}
        <strong>Estimates only, not for engineering decisions.</strong>{' '}
        <button type="button" className={styles.link} onClick={onOpenAbout}>About &amp; method</button>
      </footer>
    </>
  )
}

function Stat({ label, value: [num, unit], big }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={big ? styles.statBig : styles.statValue}>
        {num} <span className={styles.unit}>{unit}</span>
      </div>
    </div>
  )
}

function Fact({ k, v }) {
  return (
    <div className={styles.fact}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

/** Whether the ground at both ends of the axis used is above the crest */
function endsReachHighGround({ profile, crest }) {
  const pts = profile.filter(p => p.elev !== null)
  return pts.length > 1 && pts[0].elev >= crest && pts[pts.length - 1].elev >= crest
}

function Warnings({ result }) {
  if (result.status === 'nodata') {
    return (
      <div className={`${styles.callout} ${styles.danger}`}>
        This dataset has no terrain data under the dam axis. Check its coverage, or pick another dataset.
      </div>
    )
  }
  if (result.status === 'dry') {
    return (
      <div className={styles.callout}>
        The ground next to the dam on the upstream side is above the crest, so no water is held.
        Increase the height, or check the upstream side.
      </div>
    )
  }
  return (
    <>
      {result.leak && (
        <div className={`${styles.callout} ${styles.danger}`}>
          <strong>The dam doesn't seal the valley.</strong> At this height the water flows around the
          end of the dam and reaches the downstream side, so the area shown is not a real reservoir.
          {result.maxSealingHeight > 0
            ? <> The highest dam this axis can hold is about <strong>{fmtNum(result.maxSealingHeight, 1)} m</strong>. </>
            : ' '}
          {endsReachHighGround(result)
            ? 'Both ends reach high ground, so the water is escaping elsewhere: over a low saddle into another valley, or the upstream side is wrong (try Flip side).'
            : 'Lower the dam, or extend the axis up to higher ground on both banks.'}
        </div>
      )}
      {result.truncated && (
        <div className={styles.callout}>
          The reservoir is larger than the analysis limit (~16 million cells), so the figures are a lower bound.
        </div>
      )}
      {result.edgeLimited && (
        <div className={styles.callout}>
          The water reaches the edge of the loaded terrain (the dashed yellow box). Beyond it nothing is
          calculated, which is why the flood ends in straight lines.
        </div>
      )}
      {!result.leak && result.tieIn && !endsReachHighGround(result) && (
        <div className={styles.callout}>
          One end of the dam could not be tied into ground above the crest within 5 km. Check the
          cross-section below.
        </div>
      )}
    </>
  )
}
