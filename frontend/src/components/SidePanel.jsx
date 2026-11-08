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

export default function SidePanel({
  dam, drawing, height, side, tieIn, busy, progress, result, error,
  sourceId, keys, needsKey, onSourceChange, onSaveKey,
  onStartDrawing, onCancelDrawing, onHeightChange, onFlipSide, onAutoSide, onTieInChange,
}) {
  const damLength = dam ? polylineLength(dam) : 0
  const ok = result?.status === 'ok'

  return (
    <aside className={styles.panel} aria-label="Dam settings and results">
      {/* ---------- 1. Dam axis ---------- */}
      <section className={styles.section}>
        <h2 className={styles.heading}><span className={styles.num}>1</span>Dam axis</h2>
        {drawing ? (
          <>
            <p className={styles.hint}>
              Click points across the valley, from one bank to the other. Carry the line up
              both slopes, beyond where the water will reach. Click the last point again to finish.
            </p>
            <button className={styles.secondary} onClick={onCancelDrawing}>Cancel</button>
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
              min="1" max="1000" step="1"
              value={height}
              onChange={e => onHeightChange(Math.max(0, +e.target.value))}
              disabled={!dam}
              aria-label="Dam height in metres"
            />
            <span>m</span>
          </label>
        </div>
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
              {ok && !result.leak && (
                <div className={styles.headline}>
                  <Stat label="Flooded area" value={fmtArea(result.area_m2)} big />
                  <Stat label="Water volume" value={fmtVolume(result.volume_m3)} big />
                </div>
              )}

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
        survey, so lakes that already existed then count as land. Results are a first-order estimate.
      </footer>
    </aside>
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
