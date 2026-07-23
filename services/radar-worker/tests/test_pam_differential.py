"""Différentiel : pam_bitstream contre eccodes sur le message ZH réel.

eccodes ≈ 2 Go RSS sur ce message : réservé aux machines de dev/CI.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

FIXTURE = os.environ.get("RADAR_PAM_FIXTURE", "")

pytestmark = pytest.mark.skipif(
    not (FIXTURE and Path(FIXTURE).is_file()),
    reason="RADAR_PAM_FIXTURE absent : différentiel eccodes réservé au dev",
)


def test_zh_scan_matches_eccodes():
    eccodes = pytest.importorskip("eccodes")
    from pam_bitstream import parse_zh_scan, select_zh_message, split_messages

    zh = select_zh_message(split_messages(Path(FIXTURE).read_bytes()))
    scan = parse_zh_scan(zh)

    tmp = Path("/tmp/differential-zh.bufr")
    tmp.write_bytes(zh.raw)
    with tmp.open("rb") as stream:
        handle = eccodes.codes_bufr_new_from_file(stream)
        eccodes.codes_set(handle, "unpack", 1)
        oracle = np.array(
            eccodes.codes_get_array(handle, "pixelValue4Bits"), dtype=np.int64
        )
        expected = {
            "elevation_deg": float(eccodes.codes_get(handle, "#1#antennaElevation")),
            "azimuth_count": int(
                eccodes.codes_get(handle, "#1#numberOfPixelsPerColumn")
            ),
            "gate_count": int(eccodes.codes_get(handle, "#1#numberOfPixelsPerRow")),
            "gate_length_m": float(eccodes.codes_get(handle, "#1#rangeGateLength")),
            "azimuth_step_deg": float(
                eccodes.codes_get(handle, "#1#meteoFranceLocal005196")
            ),
            "station_latitude": float(eccodes.codes_get(handle, "#1#latitude")),
            "station_longitude": float(eccodes.codes_get(handle, "#1#longitude")),
            "antenna_altitude_m": float(eccodes.codes_get(handle, "#1#height")),
        }
        eccodes.codes_release(handle)

    for key, value in expected.items():
        assert getattr(scan, key) == pytest.approx(value), key

    flat = scan.codes.reshape(-1).astype(np.int64)
    # eccodes encode le manquant en très grand entier ; bitstream en 255.
    oracle_missing = oracle >= (1 << 31) - 1
    assert flat.size == scan.azimuth_count * scan.gate_count
    # La matrice principale de l'oracle occupe la FIN du flux : la sonde a
    # montré que le surplus de 80 valeurs est la table code→dBZ (321193),
    # AVANT la matrice — d'où la sélection par la queue.
    main_block = oracle[-flat.size :] if oracle.size != flat.size else oracle
    main_missing = oracle_missing[-flat.size :] if oracle.size != flat.size else oracle_missing
    assert np.array_equal(flat == 255, main_missing)
    assert np.array_equal(flat[flat != 255], main_block[~main_missing])
