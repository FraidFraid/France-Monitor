from pathlib import Path
import sys
from types import SimpleNamespace


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


def test_render_keeps_missing_reflectivity_transparent(tmp_path):
    output = tmp_path / "radar.webp"

    render_reflectivity([None, -9.0, 31.0, 70.0], width=2, height=2, output=output)

    from PIL import Image

    with Image.open(output) as image:
        assert image.mode == "RGBA"
        assert image.getpixel((0, 0))[3] == 0
        assert image.getpixel((1, 1))[3] > 0


def test_render_keeps_non_detection_value_transparent(tmp_path):
    output = tmp_path / "radar.webp"

    render_reflectivity([-40.0], width=1, height=1, output=output)

    from PIL import Image

    with Image.open(output) as image:
        assert image.getpixel((0, 0))[3] == 0


LIVE_UNEXPANDED_DESCRIPTORS = [
    1099, 30031, 1192, 301011, 301013, 8021, 4025, 4026, 29002, 29001,
    30021, 30022, 5033, 6033, 329192, 29192, 25194, 30032, 25192,
    25009, 25010, 25011, 110000, 31001, 301001, 301011, 301013, 5001,
    6001, 6196, 25210, 101000, 31001, 48192, 101000, 31001, 48192,
    101000, 31192, 21120, 103000, 31192, 201124, 10002, 201000,
    203011, 21001, 203255, 105000, 31192, 201132, 202129, 21001,
    202000, 201000, 203000,
]


def _fake_eccodes(*, minute=50):
    class ArrayLike(list):
        def __bool__(self):
            raise ValueError("array truth value is ambiguous")

    handle = object()
    messages = iter([handle, None])
    scalar = {
        "bufrHeaderCentre": 85,
        "masterTablesVersionNumber": 16,
        "localTablesVersionNumber": 14,
        "dataCategory": 6,
        "dataSubCategory": 27,
        "numberOfSubsets": 1,
        "compressedData": 0,
        "projectionType": 1,
        "numberOfPixelsPerRow": 2,
        "numberOfPixelsPerColumn": 2,
        "pixelSizeOnHorizontal1": 1000.0,
        "pixelSizeOnHorizontal2": 1000.0,
        "meteoFranceLocal029192": 0,
        "meteoFranceLocal005194": 0,
        "meteoFranceLocal005195": 45.0,
        "meteoFranceLocal006198": 0.0,
        "meteoFranceLocal030192": 224,
        "year": 2026,
        "month": 7,
        "day": 16,
        "hour": 12,
        "minute": minute,
        "second": 0,
    }
    arrays = {
        "unexpandedDescriptors": LIVE_UNEXPANDED_DESCRIPTORS,
        "latitude": ArrayLike([53.67, 49.9136]),
        "longitude": ArrayLike([-9.965, 5.5044]),
        "horizontalReflectivity": [-1e100, -9.0, 12.5, 70.0],
    }
    return SimpleNamespace(
        codes_bufr_new_from_file=lambda _stream: next(messages),
        codes_set=lambda actual, key, value: (
            actual is handle and key == "unpack" and value == 1
        ) or (_ for _ in ()).throw(AssertionError("unexpected ecCodes set")),
        codes_get=lambda actual, key: scalar[key]
        if actual is handle
        else (_ for _ in ()).throw(AssertionError("unexpected handle")),
        codes_get_array=lambda actual, key: arrays[key]
        if actual is handle
        else (_ for _ in ()).throw(AssertionError("unexpected handle")),
        codes_release=lambda actual: actual is handle
        or (_ for _ in ()).throw(AssertionError("unexpected handle")),
    )


def test_decode_bufr_accepts_live_pure_bufr_shape(tmp_path, monkeypatch):
    fixture = tmp_path / "live-imfr27.bufr"
    fixture.write_bytes(b"BUFR-live-product")
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    monkeypatch.setitem(sys.modules, "eccodes", _fake_eccodes())

    grid = decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")

    assert grid["values"] == [None, -9.0, 12.5, 70.0]
    assert grid["width"] == 2
    assert grid["height"] == 2
    assert grid["projection"]["latitudeOfTrueScale"] == 45.0
    assert grid["upperLeftProjected"] == pytest.approx(
        [-619652.074, -3526818.338], abs=0.01
    )


def test_decode_bufr_reads_only_header_prefix_before_eccodes(
    tmp_path, monkeypatch
):
    fixture = tmp_path / "live-imfr27.bufr"
    fixture.write_bytes(b"BUFR-live-product")
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    monkeypatch.setitem(sys.modules, "eccodes", _fake_eccodes())
    monkeypatch.setattr(
        Path,
        "read_bytes",
        lambda _path: (_ for _ in ()).throw(AssertionError("unbounded copy")),
    )

    grid = decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")

    assert grid["values"] == [None, -9.0, 12.5, 70.0]


def test_decode_bufr_rejects_catalogue_timestamp_mismatch(tmp_path, monkeypatch):
    fixture = tmp_path / "live-imfr27.bufr"
    fixture.write_bytes(b"BUFR-live-product")
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    monkeypatch.setitem(sys.modules, "eccodes", _fake_eccodes(minute=45))

    with pytest.raises(RadarMetadataError, match="timestamp"):
        decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")
