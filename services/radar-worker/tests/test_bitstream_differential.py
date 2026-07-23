"""Test différentiel : bufr_bitstream contre eccodes sur un BUFR réel.

Nécessite un fichier produit réel (RADAR_BUFR_FIXTURE=/chemin/xxx.bufr,
nom radar-<version>Z-<hash>.bufr) et les bindings eccodes — skippé sinon.
eccodes exige plusieurs Go : réservé aux machines de dev.
"""

from __future__ import annotations

import math
import os
from pathlib import Path
import re
import sys

import pytest

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

FIXTURE = os.environ.get("RADAR_BUFR_FIXTURE", "")

pytestmark = pytest.mark.skipif(
    not (FIXTURE and Path(FIXTURE).is_file()),
    reason="RADAR_BUFR_FIXTURE absent : test différentiel eccodes réservé au dev",
)


def test_bitstream_matches_eccodes_on_real_product():
    eccodes = pytest.importorskip("eccodes")
    from bufr_decoder import decode_bufr

    path = Path(FIXTURE)
    stamp = re.search(r"radar-(\d{8})T(\d{4})Z", path.name)
    assert stamp, "le nom du fichier doit contenir radar-YYYYMMDDTHHMMZ"
    date, time = stamp.group(1), stamp.group(2)
    observed = f"{date[:4]}-{date[4:6]}-{date[6:]}T{time[:2]}:{time[2:]}:00Z"

    grid = decode_bufr(path, observed_at=observed)

    with path.open("rb") as stream:
        handle = eccodes.codes_bufr_new_from_file(stream)
        eccodes.codes_set(handle, "unpack", 1)
        oracle = eccodes.codes_get_array(handle, "horizontalReflectivity")
        eccodes.codes_release(handle)

    assert len(oracle) == len(grid["values"])
    for index, expected in enumerate(oracle):
        actual = grid["values"][index]
        if expected <= -1e90 or expected == 9999:
            assert actual is None, index
        else:
            assert actual is not None and math.isclose(
                actual, float(expected), abs_tol=1e-9
            ), index
