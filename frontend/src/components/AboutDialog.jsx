import { useEffect, useRef } from 'react'
import { SOURCES } from '../lib/sources'
import styles from './AboutDialog.module.css'

export default function AboutDialog({ open, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal?.()
    if (!open && d.open) d.close()
  }, [open])

  const terrain = [...new Set(SOURCES.map(s => s.attribution))]

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={onClose}
      onClick={e => { if (e.target === ref.current) onClose() }}
      aria-labelledby="about-title"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <h2 id="about-title">About Dam Flood Simulator</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </header>

        <section>
          <p>
            Draw a dam across a river valley and enter its height. The simulator estimates which land
            the reservoir would flood, its surface area and the volume of water it would hold, using
            open terrain data.
          </p>
        </section>

        <section className={styles.disclaimer}>
          <h3>Not for engineering decisions</h3>
          <p>
            Results are first-order estimates for exploration and teaching. They depend on the accuracy
            and date of the terrain data. Don't use them for design, safety, or legal decisions, or for
            flood warnings.
          </p>
        </section>

        <section>
          <h3>How it works</h3>
          <ul>
            <li>The riverbed is the lowest ground along the dam axis. The crest is the riverbed plus the dam height.</li>
            <li>The reservoir is every cell connected to the upstream foot of the dam whose ground is below the crest.</li>
            <li>The upstream side is found by following the river downhill. You can flip it.</li>
            <li>Optionally, the dam ends are extended into the valley sides until the ground is above the crest.</li>
            <li>If water still reaches the downstream foot, the dam is reported as leaking, together with the highest height that seals.</li>
            <li>The analysis area grows until the reservoir fits, at about 30 m per pixel, or 60 m for very large reservoirs.</li>
          </ul>
        </section>

        <section>
          <h3>Known limits</h3>
          <ul>
            <li>Terrain data shows the surface on the day it was surveyed. A lake that already existed then counts as land, so the volume of an existing reservoir is underestimated.</li>
            <li>Surface models (Copernicus, ALOS) include trees and buildings, and may show construction sites.</li>
            <li>Narrow gorges below ~100 m wide are smoothed out by 30 m data.</li>
            <li>Evaporation, sediment, seepage and spillways are not modelled.</li>
          </ul>
        </section>

        <section>
          <h3>Privacy</h3>
          <p>
            There are no accounts and no tracking. The app runs entirely in your browser. It only
            contacts map tile and terrain data services. API keys you enter are stored only in this
            browser, and each key is sent only to the service it belongs to.
          </p>
        </section>

        <section>
          <h3>Data credits</h3>
          <p className={styles.small}>
            <strong>Terrain:</strong> {terrain.join(' · ')}.
          </p>
          <p className={styles.small}>
            <strong>Basemaps:</strong> OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors ·
            OpenTopoMap (CC-BY-SA) · Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified
            Copernicus Sentinel data 2016 &amp; 2017) · MapTiler · Mapbox.
          </p>
        </section>
      </div>
    </dialog>
  )
}
