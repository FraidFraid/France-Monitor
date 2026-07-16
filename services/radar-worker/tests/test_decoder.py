import base64
from pathlib import Path
import sys


WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

import pytest

import bufr_decoder
import models
from bufr_decoder import decode_bufr, decode_reflectivity_codes, grid_from_descriptors
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


def test_render_keeps_non_detection_code_transparent(tmp_path):
    output = tmp_path / "radar.webp"

    render_reflectivity([161], width=1, height=1, output=output)

    from PIL import Image

    with Image.open(output) as image:
        assert image.getpixel((0, 0))[3] == 0


def test_decode_bufr_uses_official_321193_pixel_reflectivity_structure(
    tmp_path, monkeypatch
):
    encoded = (
        Path(__file__).parent / "fixtures" / "synthetic_imfr27.bufr.b64"
    ).read_text(encoding="ascii")
    fixture = tmp_path / "synthetic_imfr27.bufr"
    fixture.write_bytes(base64.b64decode(encoded))
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)

    grid = decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")

    assert grid["values"] == [1, 2, 3, 4]
    assert grid["width"] == 2
    assert grid["height"] == 2


def test_decode_bufr_reads_only_header_prefix_before_eccodes(
    tmp_path, monkeypatch
):
    encoded = (
        Path(__file__).parent / "fixtures" / "synthetic_imfr27.bufr.b64"
    ).read_text(encoding="ascii")
    fixture = tmp_path / "synthetic_imfr27.bufr"
    fixture.write_bytes(base64.b64decode(encoded))
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    monkeypatch.setattr(
        Path,
        "read_bytes",
        lambda _path: (_ for _ in ()).throw(AssertionError("unbounded copy")),
    )

    grid = decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")

    assert grid["values"] == [1, 2, 3, 4]


def test_decode_bufr_rejects_product_identity_outside_structured_gts_header(
    tmp_path, monkeypatch
):
    encoded = (
        Path(__file__).parent / "fixtures" / "synthetic_imfr27.bufr.b64"
    ).read_text(encoding="ascii")
    payload = base64.b64decode(encoded).replace(b"IMFR27 LFPW", b"IMFR28 LFPW", 1)
    fixture = tmp_path / "wrong-product.bufr"
    fixture.write_bytes(payload + b"IMFR27_C_LFPW")
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)

    with pytest.raises(RadarMetadataError, match="GTS header"):
        decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")
