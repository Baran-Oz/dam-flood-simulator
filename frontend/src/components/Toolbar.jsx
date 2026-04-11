import './Toolbar.css'

const STEP_LABELS = {
  idle:     '1. Draw the dam wall on the map using the polyline tool.',
  seed:     '2. Click a point on the reservoir side of the dam (upstream).',
  fetching: 'Downloading elevation data…',
  ready:    '3. Move the slider to set the water level.',
  error:    'An error occurred. See message below.',
}

export default function Toolbar({
  step, loading, error, elevRange, waterLevel, damCrest, onWaterLevelChange
}) {
  const sliderMin = elevRange.min
  const sliderMax = elevRange.max
  const step_size = Math.max(0.1, (sliderMax - sliderMin) / 500)

  const damHeight = damCrest != null
    ? Math.max(0, waterLevel - damCrest).toFixed(1)
    : null

  return (
    <aside className="toolbar">
      <div className={`step-hint ${step === 'error' ? 'hint-error' : ''}`}>
        {loading && step === 'fetching'
          ? 'Downloading elevation data…'
          : STEP_LABELS[step]}
      </div>

      {error && <div className="error-box">{error}</div>}

      {step === 'ready' && (
        <div className="slider-section">
          <div className="slider-labels">
            <span className="slider-label-title">Water Level</span>
            <span className="slider-value">{waterLevel.toFixed(1)} m ASL</span>
          </div>

          {damHeight !== null && (
            <div className="dam-height-badge">
              {parseFloat(damHeight) > 0
                ? `+${damHeight} m above dam base`
                : 'Below dam base'}
            </div>
          )}

          <input
            type="range"
            className="water-slider"
            min={sliderMin}
            max={sliderMax}
            step={step_size}
            value={waterLevel}
            onChange={e => onWaterLevelChange(parseFloat(e.target.value))}
          />

          <div className="slider-endpoints">
            <span>{sliderMin.toFixed(0)} m</span>
            <span>{sliderMax.toFixed(0)} m</span>
          </div>

          {damCrest != null && (
            <div className="elev-info">
              <span>Dam base elev: <strong>{damCrest.toFixed(1)} m</strong></span>
            </div>
          )}
        </div>
      )}

      {loading && step === 'ready' && (
        <div className="computing-badge">Computing…</div>
      )}
    </aside>
  )
}
