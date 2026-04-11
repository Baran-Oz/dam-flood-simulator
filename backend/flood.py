"""
Flood simulation engine.

Given a DEM, a dam wall line, a water surface elevation (m ASL), and a seed
point on the reservoir side, computes the connected flooded region, its
surface area (km²), and water volume (m³).
"""

import numpy as np
from scipy.ndimage import label
from rasterio.transform import rowcol
from rasterio.features import shapes, rasterize
from shapely.geometry import mapping, LineString, shape
from shapely.ops import unary_union
import math


# 8-connectivity for flood fill
CONNECTIVITY = np.ones((3, 3), dtype=int)


def _cell_areas(transform, shape_rc):
    """
    Compute area of each DEM cell in m².
    Varies with latitude because we're in geographic (lon/lat) projection.
    """
    nrows, ncols = shape_rc
    pixel_height_deg = abs(transform.e)   # degrees per pixel latitude
    pixel_width_deg  = abs(transform.a)   # degrees per pixel longitude

    # Latitude at the centre of each row
    lats = np.array(
        [transform.f + (r + 0.5) * transform.e for r in range(nrows)],
        dtype=np.float64
    )

    height_m = pixel_height_deg * 110_574.0
    width_m  = pixel_width_deg  * 111_320.0 * np.cos(np.radians(lats))

    # Broadcast to full 2-D array (rows × cols)
    return (height_m * width_m[:, np.newaxis]).astype(np.float64)


def _rasterize_dam(coords_lonlat, transform, out_shape):
    """
    Rasterize the dam wall line with a 2-pixel buffer so it acts as a
    continuous barrier for the flood fill.
    """
    line = LineString(coords_lonlat)
    buf_deg = abs(transform.a) * 2.0          # 2-pixel buffer in degrees
    buffered = line.buffer(buf_deg)

    mask = rasterize(
        [(mapping(buffered), 1)],
        out_shape=out_shape,
        transform=transform,
        fill=0,
        dtype=np.uint8,
    )
    return mask.astype(bool)


def _to_geojson(mask_uint8, transform):
    """Convert a binary raster mask to a GeoJSON FeatureCollection."""
    polys = [
        geom for geom, val
        in shapes(mask_uint8, mask=mask_uint8, transform=transform)
        if val == 1
    ]
    if not polys:
        return {"type": "FeatureCollection", "features": []}

    # Merge all polygons into one (handles fragmented pixels)
    merged = unary_union([shape(p) for p in polys])
    # Simplify slightly to reduce payload size (~1/4 pixel tolerance)
    simplified = merged.simplify(abs(transform.a) * 0.25, preserve_topology=True)

    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": mapping(simplified), "properties": {}}
        ],
    }


def simulate(dem: np.ndarray, transform, dam_coords_lonlat: list,
             water_level_m: float, seed_lonlat: tuple) -> dict:
    """
    Run a flood simulation.

    Parameters
    ----------
    dem               : 2-D float32 array of elevation (m ASL); NaN = no-data
    transform         : rasterio Affine transform (EPSG:4326)
    dam_coords_lonlat : list of [lon, lat] pairs defining the dam wall
    water_level_m     : water surface elevation in m ASL
    seed_lonlat       : (lon, lat) of a point on the reservoir side

    Returns
    -------
    dict with keys: geojson, area_km2, volume_m3,
                    min_elev, max_elev, dam_crest_elev
    """
    # Replace NaN with a very high value so it never floods
    dem_safe = np.where(np.isnan(dem), 9999.0, dem).astype(np.float32)

    # Rasterize dam wall
    dam_mask = _rasterize_dam(dam_coords_lonlat, transform, dem.shape)

    # Candidate cells: at or below water level AND not blocked by dam
    candidates = (dem_safe <= water_level_m) & (~dam_mask)

    if not candidates.any():
        return _empty_result(dem_safe, water_level_m, dam_mask, transform, dam_coords_lonlat)

    # Label connected components (8-connectivity)
    labeled, _ = label(candidates, structure=CONNECTIVITY)

    # Map seed point to raster pixel
    seed_row, seed_col = rowcol(transform, seed_lonlat[0], seed_lonlat[1])
    seed_row = int(np.clip(seed_row, 0, dem.shape[0] - 1))
    seed_col = int(np.clip(seed_col, 0, dem.shape[1] - 1))

    if not candidates[seed_row, seed_col]:
        # Seed is above water or on dam — find nearest candidate
        seed_row, seed_col = _nearest_candidate(candidates, seed_row, seed_col)

    if seed_row is None:
        return _empty_result(dem_safe, water_level_m, dam_mask, transform, dam_coords_lonlat)

    flood_label = labeled[seed_row, seed_col]
    flooded = (labeled == flood_label).astype(np.uint8)

    # Area and volume
    areas = _cell_areas(transform, dem.shape)
    flooded_bool = flooded.astype(bool)
    depth = np.maximum(water_level_m - dem_safe, 0.0) * flooded_bool

    area_m2  = float(np.sum(flooded_bool * areas))
    volume_m3 = float(np.sum(depth * areas))

    # GeoJSON polygon
    geojson = _to_geojson(flooded, transform)

    # Elevation stats
    valid = dem_safe[dem_safe < 9000]
    dam_crest = _dam_crest_elevation(dem_safe, transform, dam_coords_lonlat)

    return {
        "geojson":       geojson,
        "area_km2":      area_m2 / 1e6,
        "volume_m3":     volume_m3,
        "min_elev":      float(np.nanmin(valid)) if valid.size else 0.0,
        "max_elev":      float(np.nanmax(valid)) if valid.size else 100.0,
        "dam_crest_elev": dam_crest,
    }


def _empty_result(dem_safe, water_level_m, dam_mask, transform, dam_coords_lonlat):
    valid = dem_safe[dem_safe < 9000]
    dam_crest = _dam_crest_elevation(dem_safe, transform, dam_coords_lonlat)
    return {
        "geojson":       {"type": "FeatureCollection", "features": []},
        "area_km2":      0.0,
        "volume_m3":     0.0,
        "min_elev":      float(np.nanmin(valid)) if valid.size else 0.0,
        "max_elev":      float(np.nanmax(valid)) if valid.size else 100.0,
        "dam_crest_elev": dam_crest,
    }


def _nearest_candidate(candidates: np.ndarray, row: int, col: int):
    """Find the nearest True cell to (row, col) using expanding search."""
    rows, cols = candidates.shape
    for radius in range(1, max(rows, cols)):
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                if abs(dr) != radius and abs(dc) != radius:
                    continue
                r, c = row + dr, col + dc
                if 0 <= r < rows and 0 <= c < cols and candidates[r, c]:
                    return r, c
    return None, None


def _dam_crest_elevation(dem_safe, transform, dam_coords_lonlat):
    """Estimate the dam crest elevation from DEM values along the dam line."""
    elevations = []
    for lon, lat in dam_coords_lonlat:
        r, c = rowcol(transform, lon, lat)
        r = int(np.clip(r, 0, dem_safe.shape[0] - 1))
        c = int(np.clip(c, 0, dem_safe.shape[1] - 1))
        elev = dem_safe[r, c]
        if elev < 9000:
            elevations.append(float(elev))
    return float(np.mean(elevations)) if elevations else 0.0


def get_elevation_range(dem: np.ndarray):
    """Return (min, max) of valid elevation values."""
    valid = dem[~np.isnan(dem)]
    if valid.size == 0:
        return 0.0, 100.0
    return float(np.min(valid)), float(np.max(valid))
