"""
DEM fetching from AWS Terrain Tiles (Terrarium format).
No API key required — public dataset.
Terrarium elevation encoding: R*256 + G + B/256 - 32768
"""

import math
import io
import numpy as np
import requests
from PIL import Image
from rasterio.transform import from_bounds


TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TILE_SIZE = 256
NO_DATA = -32768.0
OCEAN_THRESHOLD = -100.0  # treat below this as no-data


def _lon_to_tile_x(lon: float, zoom: int) -> int:
    return int((lon + 180.0) / 360.0 * (2 ** zoom))


def _lat_to_tile_y(lat: float, zoom: int) -> int:
    lat_rad = math.radians(lat)
    n = 2 ** zoom
    return int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)


def _tile_nw_corner(tx: int, ty: int, zoom: int) -> tuple[float, float]:
    """Return (lon, lat) of north-west corner of tile."""
    n = 2 ** zoom
    lon = tx / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ty / n)))
    lat = math.degrees(lat_rad)
    return lon, lat


def _choose_zoom(west: float, south: float, east: float, north: float) -> int:
    """Choose zoom level so pixel size is ~30–40 m."""
    center_lat = (north + south) / 2.0
    width_m = (east - west) * 111_320 * math.cos(math.radians(center_lat))
    if width_m < 8_000:
        return 14   # ~10 m/px
    if width_m < 25_000:
        return 13   # ~20 m/px
    if width_m < 80_000:
        return 12   # ~40 m/px
    return 11       # ~80 m/px


def _decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    return r * 256.0 + g + b / 256.0 - 32768.0


def _fetch_tile(tx: int, ty: int, zoom: int) -> np.ndarray:
    url = TILE_URL.format(z=zoom, x=tx, y=ty)
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    return _decode_terrarium(np.array(img, dtype=np.float32))


def fetch_dem(west: float, south: float, east: float, north: float):
    """
    Fetch and mosaic terrain tiles for a bounding box.

    Returns
    -------
    dem   : 2-D float32 numpy array of elevation in metres ASL
    transform : rasterio Affine transform (EPSG:4326)
    """
    zoom = _choose_zoom(west, south, east, north)
    n_tiles = 2 ** zoom

    tx_min = _lon_to_tile_x(west, zoom)
    tx_max = _lon_to_tile_x(east, zoom)
    ty_min = _lat_to_tile_y(north, zoom)   # note: y increases southward
    ty_max = _lat_to_tile_y(south, zoom)

    # Clamp to valid range
    tx_min = max(0, min(tx_min, n_tiles - 1))
    tx_max = max(0, min(tx_max, n_tiles - 1))
    ty_min = max(0, min(ty_min, n_tiles - 1))
    ty_max = max(0, min(ty_max, n_tiles - 1))

    n_rows = ty_max - ty_min + 1
    n_cols = tx_max - tx_min + 1

    mosaic = np.zeros((n_rows * TILE_SIZE, n_cols * TILE_SIZE), dtype=np.float32)

    for ty in range(ty_min, ty_max + 1):
        for tx in range(tx_min, tx_max + 1):
            tile = _fetch_tile(tx, ty, zoom)
            r0 = (ty - ty_min) * TILE_SIZE
            c0 = (tx - tx_min) * TILE_SIZE
            mosaic[r0: r0 + TILE_SIZE, c0: c0 + TILE_SIZE] = tile

    # Actual geographic extent of the mosaic
    mosaic_west, mosaic_north = _tile_nw_corner(tx_min, ty_min, zoom)
    mosaic_east, mosaic_south = _tile_nw_corner(tx_max + 1, ty_max + 1, zoom)

    full_transform = from_bounds(
        mosaic_west, mosaic_south, mosaic_east, mosaic_north,
        mosaic.shape[1], mosaic.shape[0]
    )

    # Clip to the requested bbox
    from rasterio.transform import rowcol
    r_start, c_start = rowcol(full_transform, west, north)
    r_end, c_end = rowcol(full_transform, east, south)

    r_start = int(max(0, r_start))
    c_start = int(max(0, c_start))
    r_end = int(min(mosaic.shape[0], r_end))
    c_end = int(min(mosaic.shape[1], c_end))

    clipped = mosaic[r_start:r_end, c_start:c_end]

    # Rebuild transform for the clipped array
    clip_transform = from_bounds(
        west, south, east, north,
        clipped.shape[1], clipped.shape[0]
    )

    # Mask obvious no-data (ocean / below -100 m)
    clipped = np.where(clipped < OCEAN_THRESHOLD, np.nan, clipped)

    return clipped, clip_transform
