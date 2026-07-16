from pathlib import Path
import sys


WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

import pytest

from bufr_decoder import decode_reflectivity_codes, grid_from_descriptors
from models import RadarMetadataError
from render import render_reflectivity


def test_normalizes_reflectivity_codes():
    values = decode_reflectivity_codes([0, 2, 160, 161, 255])

    assert values == [-9.0, -8.0, 70.0, -40.0, None]


def test_rejects_missing_projection_descriptor():
    descriptors = {
        "030021": 1536,
        "030022": 1536,
        "005033": 1000,
        "006033": 1000,
    }

    with pytest.raises(RadarMetadataError, match="029001"):
        grid_from_descriptors(
            descriptors,
            pixel_codes=[],
            product_id="IMFR27_C_LFPW",
            observed_at="2026-07-16T12:50:00Z",
        )


def test_render_keeps_missing_pixels_transparent(tmp_path):
    output = tmp_path / "radar.webp"

    render_reflectivity([255, 0, 80, 160], width=2, height=2, output=output)

    from PIL import Image

    with Image.open(output) as image:
        assert image.mode == "RGBA"
        assert image.getpixel((0, 0))[3] == 0
        assert image.getpixel((1, 1))[3] > 0
