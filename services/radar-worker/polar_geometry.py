"""Géométrie polaire radar : fonctions pures, aucune I/O.

Altitude du faisceau : modèle standard « 4/3 de rayon terrestre »
(réfraction atmosphérique moyenne). Distances sur sphère de rayon moyen.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from pam_bitstream import PolarScanZh, ZH_CODE_MISSING, ZH_CODE_NO_ECHO, ZH_DBZ_GAIN, ZH_DBZ_OFFSET

EARTH_RADIUS_M = 6_371_000.0
EFFECTIVE_RADIUS_M = EARTH_RADIUS_M * 4.0 / 3.0


@dataclass(frozen=True)
class ColumnSample:
    elevation_deg: float
    altitude_m: float
    dbz: float | None


def great_circle_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def initial_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def destination_point(
    lat: float, lon: float, bearing_deg: float, distance_m: float
) -> tuple[float, float]:
    p1 = math.radians(lat)
    l1 = math.radians(lon)
    theta = math.radians(bearing_deg)
    delta = distance_m / EARTH_RADIUS_M
    p2 = math.asin(
        math.sin(p1) * math.cos(delta) + math.cos(p1) * math.sin(delta) * math.cos(theta)
    )
    l2 = l1 + math.atan2(
        math.sin(theta) * math.sin(delta) * math.cos(p1),
        math.cos(delta) - math.sin(p1) * math.sin(p2),
    )
    return math.degrees(p2), ((math.degrees(l2) + 540.0) % 360.0) - 180.0


def beam_altitude_m(
    slant_range_m: float, elevation_deg: float, antenna_altitude_m: float
) -> float:
    el = math.radians(elevation_deg)
    return (
        math.sqrt(
            slant_range_m**2
            + EFFECTIVE_RADIUS_M**2
            + 2.0 * slant_range_m * EFFECTIVE_RADIUS_M * math.sin(el)
        )
        - EFFECTIVE_RADIUS_M
        + antenna_altitude_m
    )


def beam_ground_distance_m(slant_range_m: float, elevation_deg: float) -> float:
    el = math.radians(elevation_deg)
    altitude = beam_altitude_m(slant_range_m, elevation_deg, 0.0)
    return EFFECTIVE_RADIUS_M * math.asin(
        slant_range_m * math.cos(el) / (EFFECTIVE_RADIUS_M + altitude)
    )


def column_sample(scan: PolarScanZh, lat: float, lon: float) -> ColumnSample | None:
    """Échantillon du scan au droit du point, ou None si hors portée."""
    ground = great_circle_distance_m(
        scan.station_latitude, scan.station_longitude, lat, lon
    )
    bearing = initial_bearing_deg(
        scan.station_latitude, scan.station_longitude, lat, lon
    )
    az_index = round(
        ((bearing - scan.azimuth_start_deg) % 360.0) / scan.azimuth_step_deg
    ) % scan.azimuth_count
    # Porte dont la distance sol est la plus proche du point.
    gates = (np.arange(scan.gate_count) + 0.5) * scan.gate_length_m
    grounds = np.array(
        [beam_ground_distance_m(float(r), scan.elevation_deg) for r in gates]
    )
    gate_index = int(np.argmin(np.abs(grounds - ground)))
    if abs(grounds[gate_index] - ground) > scan.gate_length_m:
        return None
    slant = float(gates[gate_index])
    code = int(scan.codes[az_index, gate_index])
    if code in (ZH_CODE_MISSING, ZH_CODE_NO_ECHO):
        dbz: float | None = None
    else:
        dbz = code * ZH_DBZ_GAIN + ZH_DBZ_OFFSET
    return ColumnSample(
        elevation_deg=scan.elevation_deg,
        altitude_m=beam_altitude_m(slant, scan.elevation_deg, scan.antenna_altitude_m),
        dbz=dbz,
    )
