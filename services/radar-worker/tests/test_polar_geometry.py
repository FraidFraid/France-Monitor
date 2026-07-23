"""Géométrie polaire : valeurs de référence calculées à la main."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from pam_bitstream import ZH_DBZ_GAIN, ZH_DBZ_OFFSET  # noqa: E402
from polar_geometry import (  # noqa: E402
    beam_altitude_m,
    beam_ground_distance_m,
    column_sample,
    destination_point,
    great_circle_distance_m,
    initial_bearing_deg,
)


def test_great_circle_paris_bordeaux():
    # Paris (48.8566, 2.3522) → Bordeaux (44.8378, -0.5792) ≈ 499,3 km.
    assert great_circle_distance_m(48.8566, 2.3522, 44.8378, -0.5792) == pytest.approx(
        499_300, rel=0.01
    )


def test_bearing_due_north_and_east():
    assert initial_bearing_deg(44.0, 0.0, 45.0, 0.0) == pytest.approx(0.0, abs=0.1)
    assert initial_bearing_deg(44.0, 0.0, 44.0, 1.0) == pytest.approx(90.0, abs=1.0)


def test_destination_roundtrip():
    lat, lon = destination_point(44.831, -0.692, 135.0, 80_000.0)
    assert great_circle_distance_m(44.831, -0.692, lat, lon) == pytest.approx(
        80_000.0, rel=1e-3
    )
    assert initial_bearing_deg(44.831, -0.692, lat, lon) == pytest.approx(135.0, abs=0.5)


def test_beam_altitude_flat_and_elevated():
    # À élévation 0° et 50 km, la courbure 4/3 donne ≈ 147 m au-dessus de
    # l'antenne (r²/(2·R'), R' = 8495 km).
    assert beam_altitude_m(50_000.0, 0.0, 0.0) == pytest.approx(147.0, rel=0.05)
    # À 8° et 50 km, dominé par r·sin(el) ≈ 6 959 m + courbure.
    assert beam_altitude_m(50_000.0, 8.0, 50.0) == pytest.approx(7_150.0, rel=0.02)


def test_ground_distance_below_slant():
    assert beam_ground_distance_m(50_000.0, 8.0) == pytest.approx(
        50_000.0 * np.cos(np.radians(8.0)), rel=0.01
    )


def _synthetic_scan(elevation_deg: float = 1.0):
    from pam_bitstream import PolarScanZh

    codes = np.full((720, 200), 255, dtype=np.uint8)
    # Azimut 90° (index dépend du départ 0°), portes 10 km → code 40
    # (= 40·1,0 − 10,5 = 29,5 dBZ avec la conversion verrouillée par la LUT).
    codes[180, :] = 40
    return PolarScanZh(
        observed_at_utc=(2026, 7, 23, 8, 30, 0),
        station_latitude=44.831,
        station_longitude=-0.692,
        antenna_altitude_m=50.0,
        elevation_deg=elevation_deg,
        azimuth_start_deg=0.0,
        azimuth_step_deg=0.5,
        azimuth_count=720,
        gate_count=200,
        gate_length_m=240.0,
        codes=codes,
    )


def test_column_sample_hits_painted_azimuth():
    scan = _synthetic_scan()
    # Point à 20 km plein est de la station (bearing 90° → index 180).
    lat, lon = destination_point(44.831, -0.692, 90.0, 20_000.0)
    sample = column_sample(scan, lat, lon)
    assert sample is not None
    assert sample.elevation_deg == 1.0
    assert sample.dbz == pytest.approx(40 * ZH_DBZ_GAIN + ZH_DBZ_OFFSET)
    assert sample.altitude_m == pytest.approx(
        beam_altitude_m(20_000.0 / np.cos(np.radians(1.0)), 1.0, 50.0), rel=0.05
    )


def test_column_sample_out_of_range_returns_none():
    scan = _synthetic_scan()
    lat, lon = destination_point(44.831, -0.692, 90.0, 300_000.0)
    assert column_sample(scan, lat, lon) is None


def test_column_sample_no_echo_is_none_dbz():
    scan = _synthetic_scan()
    lat, lon = destination_point(44.831, -0.692, 270.0, 20_000.0)
    sample = column_sample(scan, lat, lon)
    assert sample is not None and sample.dbz is None
