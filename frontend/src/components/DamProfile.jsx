import styles from './SidePanel.module.css'

const W = 300, H = 130
const PAD = { l: 34, r: 8, t: 10, b: 20 }

/**
 * Cross-section along the dam axis: ground profile, crest line, and the dam
 * body between them. If the ground at either end is below the crest, the
 * water can get around the dam there, and that end is marked.
 */
export default function DamProfile({ profile, crest, base }) {
  const pts = profile.filter(p => p.elev !== null)
  if (pts.length < 2) return null

  const step = Math.max(1, Math.floor(pts.length / 300))
  const s = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)

  const len = s[s.length - 1].d || 1
  const lo = Math.min(base, ...s.map(p => p.elev))
  const hi = Math.max(crest, ...s.map(p => p.elev))
  const span = Math.max(1, hi - lo)
  const y0 = lo - span * 0.08, y1 = hi + span * 0.08

  const x = d => PAD.l + (d / len) * (W - PAD.l - PAD.r)
  const y = e => PAD.t + (1 - (e - y0) / (y1 - y0)) * (H - PAD.t - PAD.b)

  const groundLine = s.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.elev).toFixed(1)}`).join('')
  const groundArea = `${groundLine}L${x(len)},${H - PAD.b}L${x(0)},${H - PAD.b}Z`
  const damBody =
    s.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(Math.min(p.elev, crest)).toFixed(1)}`).join('') +
    `L${x(len)},${y(crest)}L${x(0)},${y(crest)}Z`

  const startLow = s[0].elev < crest
  const endLow = s[s.length - 1].elev < crest

  return (
    <figure className={styles.profile}>
      <figcaption className={styles.profileTitle}>Dam axis cross-section</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Ground profile along the dam axis with crest at ${crest.toFixed(0)} m`}>
        <path d={groundArea} className={styles.pGround} />
        <path d={damBody} className={styles.pDam} />
        <path d={groundLine} className={styles.pGroundLine} />
        <line x1={x(0)} x2={x(len)} y1={y(crest)} y2={y(crest)} className={styles.pCrest} />
        <text x={PAD.l - 4} y={y(crest) + 3} className={styles.pLabel} textAnchor="end">{crest.toFixed(0)}</text>
        <text x={PAD.l - 4} y={y(base) + 3} className={styles.pLabel} textAnchor="end">{base.toFixed(0)}</text>
        <text x={x(0)} y={H - 6} className={styles.pLabel}>0</text>
        <text x={x(len)} y={H - 6} className={styles.pLabel} textAnchor="end">
          {len >= 1000 ? `${(len / 1000).toFixed(2)} km` : `${len.toFixed(0)} m`}
        </text>
        {startLow && <circle cx={x(0)} cy={y(s[0].elev)} r="4" className={styles.pWarn} />}
        {endLow && <circle cx={x(len)} cy={y(s[s.length - 1].elev)} r="4" className={styles.pWarn} />}
      </svg>
      {(startLow || endLow) && (
        <p className={styles.profileNote}>
          A red dot marks an end where the ground is below the crest, so water can get around the dam there.
        </p>
      )}
    </figure>
  )
}
