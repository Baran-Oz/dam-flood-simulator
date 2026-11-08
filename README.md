# Dam Flood Simulator

Estimate which land a dam would flood. Draw the dam's axis across a river valley and enter its height. The app finds the reservoir that fills behind it to the crest, and reports its surface area, water volume and depths. It uses open terrain data and runs entirely in the browser.

**Live app:** https://baran-oz.github.io/dam-flood-simulator/

## How it works

- **Riverbed** = lowest ground along the dam axis. **Crest** = riverbed + dam height.
- The reservoir is every cell connected to the upstream foot of the dam whose ground is below the crest. The upstream side is found by following the river downhill (it can be flipped).
- The dam ends can be extended into the valley sides until the ground is above the crest. If water still reaches the downstream foot, the dam is reported as leaking, together with the highest height that seals.
- The analysis area grows until the reservoir fits (about 30 m per pixel, or 60 m for very large reservoirs).

Checked against real dams: Ilısu gives 298 km² and 10.0 km³ (official: 313 km², 10.4 km³). Lake Mead's area gives 644 km² (official: ~640 km²).

## Terrain data

| No key needed | Free API key |
|---|---|
| AWS Terrain Tiles (default) | Mapbox Terrain-DEM |
| Copernicus GLO-30 / GLO-90 | MapTiler Terrain RGB |
| NASADEM | OpenTopography: SRTM GL1, Copernicus, NASADEM, AW3D30, EU DTM |
| ALOS World 3D | |
| USGS 3DEP 10 m (US only) | |

API keys are stored only in your browser and sent only to the service they belong to.

## Limits

Results are first-order estimates for exploration and teaching, **not for engineering, safety or legal decisions**. Terrain data shows the surface on the day it was surveyed. Lakes that already existed then count as land, so the volume of an existing reservoir is underestimated. Surface models (Copernicus, ALOS) include trees, buildings and construction sites.

## Development

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # production build in frontend/dist
```

On Windows, `start.bat` installs the dependencies and starts the dev server.

Every push to `master` runs the tests, builds the app and deploys it to GitHub Pages (`.github/workflows/deploy.yml`). The Content-Security-Policy is generated from `frontend/security.config.js`. Add a host there whenever you add a new data source.

## Credits

Terrain: AWS Terrain Tiles (Mapzen / Tilezen), Copernicus DEM © DLR / Airbus, NASADEM (NASA JPL), AW3D30 © JAXA, USGS 3DEP (via Microsoft Planetary Computer), Mapbox, MapTiler, OpenTopography.
Basemaps: OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors, OpenTopoMap (CC-BY-SA), Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016 & 2017).
