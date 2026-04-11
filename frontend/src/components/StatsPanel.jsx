import './StatsPanel.css'

function fmt_area(km2) {
  if (km2 >= 1) return `${km2.toFixed(2)} km²`
  return `${(km2 * 1e6).toFixed(0)} m²`
}

function fmt_volume(m3) {
  if (m3 >= 1e9) return `${(m3 / 1e9).toFixed(3)} km³`
  if (m3 >= 1e6) return `${(m3 / 1e6).toFixed(2)} M m³`
  if (m3 >= 1e3) return `${(m3 / 1e3).toFixed(1)} k m³`
  return `${m3.toFixed(0)} m³`
}

export default function StatsPanel({ step, loading, simResult, waterLevel, damCrest }) {
  if (step === 'idle' || step === 'seed') {
    return (
      <aside className="stats-panel stats-empty">
        <p>Stats will appear here after the simulation runs.</p>
      </aside>
    )
  }

  const hasResult = simResult && (simResult.area_km2 > 0 || simResult.volume_m3 > 0)
  const damHeight = damCrest != null ? Math.max(0, waterLevel - damCrest) : null

  return (
    <aside className="stats-panel">
      <div className="stats-title">Reservoir Stats</div>

      <div className="stat-card">
        <div className="stat-label">Flooded Area</div>
        <div className={`stat-value ${loading ? 'stat-loading' : ''}`}>
          {hasResult ? fmt_area(simResult.area_km2) : '—'}
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-label">Water Volume</div>
        <div className={`stat-value ${loading ? 'stat-loading' : ''}`}>
          {hasResult ? fmt_volume(simResult.volume_m3) : '—'}
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-label">Water Level</div>
        <div className="stat-value stat-blue">{waterLevel.toFixed(1)} m ASL</div>
      </div>

      {damHeight !== null && (
        <div className="stat-card">
          <div className="stat-label">Dam Height (water)</div>
          <div className="stat-value stat-amber">{damHeight.toFixed(1)} m</div>
        </div>
      )}

      {simResult?.hitsBoundary && !loading && (
        <div className="boundary-warning">
          ⚠ The reservoir reaches the edge of the calculated area. Results may be
          incomplete. Reset and place the seed point closer to the dam.
        </div>
      )}

      {!hasResult && !loading && step === 'ready' && (
        <div className="no-flood-note">
          No flooded area detected at this water level.<br />
          Try raising the slider or check the seed point.
        </div>
      )}
    </aside>
  )
}
