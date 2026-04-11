"""
FastAPI backend for the Dam Flood Simulation app.

Endpoints
---------
POST /api/fetch-dem   – download DEM for a bounding box and cache it
POST /api/simulate    – run flood fill for a given water level
"""

import hashlib
import json
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from dem import fetch_dem
from flood import simulate, get_elevation_range

app = FastAPI(title="Dam Flood Simulator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory DEM cache: bbox_hash -> (dem_array, transform)
_dem_cache: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class BBoxModel(BaseModel):
    west: float
    south: float
    east: float
    north: float


class FetchDEMRequest(BaseModel):
    bbox: BBoxModel


class SimulateRequest(BaseModel):
    dem_id: str
    dam_coords: list[list[float]]   # [[lon, lat], ...]
    water_level_m: float
    seed_point: list[float]         # [lon, lat]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _bbox_to_key(bbox: BBoxModel) -> str:
    raw = f"{bbox.west:.5f}_{bbox.south:.5f}_{bbox.east:.5f}_{bbox.north:.5f}"
    return hashlib.md5(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/api/fetch-dem")
async def api_fetch_dem(req: FetchDEMRequest):
    """
    Download and cache the DEM for the given bounding box.
    Returns elevation range info and a dem_id for subsequent simulate calls.
    """
    b = req.bbox

    # Basic sanity checks
    if b.east <= b.west or b.north <= b.south:
        raise HTTPException(400, "Invalid bounding box")
    if (b.east - b.west) > 2.0 or (b.north - b.south) > 2.0:
        raise HTTPException(400, "Bounding box too large (max 2° × 2°)")

    dem_id = _bbox_to_key(b)

    if dem_id not in _dem_cache:
        try:
            dem, transform = fetch_dem(b.west, b.south, b.east, b.north)
        except Exception as exc:
            raise HTTPException(502, f"Failed to fetch DEM tiles: {exc}") from exc
        _dem_cache[dem_id] = (dem, transform)
    else:
        dem, transform = _dem_cache[dem_id]

    min_elev, max_elev = get_elevation_range(dem)

    return {
        "dem_id":    dem_id,
        "min_elev":  round(min_elev, 1),
        "max_elev":  round(max_elev, 1),
        "rows":      dem.shape[0],
        "cols":      dem.shape[1],
    }


@app.post("/api/simulate")
async def api_simulate(req: SimulateRequest):
    """
    Run flood simulation for the given water level.
    """
    if req.dem_id not in _dem_cache:
        raise HTTPException(404, "DEM not found — call /api/fetch-dem first")

    dem, transform = _dem_cache[req.dem_id]

    if len(req.dam_coords) < 2:
        raise HTTPException(400, "Dam wall needs at least 2 points")

    try:
        result = simulate(
            dem=dem,
            transform=transform,
            dam_coords_lonlat=req.dam_coords,
            water_level_m=req.water_level_m,
            seed_lonlat=tuple(req.seed_point),
        )
    except Exception as exc:
        raise HTTPException(500, f"Simulation error: {exc}") from exc

    return {
        "geojson":        result["geojson"],
        "area_km2":       round(result["area_km2"], 4),
        "volume_m3":      round(result["volume_m3"], 0),
        "min_elev":       round(result["min_elev"], 1),
        "max_elev":       round(result["max_elev"], 1),
        "dam_crest_elev": round(result["dam_crest_elev"], 1),
    }


@app.get("/api/health")
async def health():
    return {"status": "ok"}
