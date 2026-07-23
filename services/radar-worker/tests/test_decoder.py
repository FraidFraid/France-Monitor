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


class _BitWriter:
    def __init__(self):
        self._bits = []

    def write(self, value, width):
        self._bits.extend((value >> (width - 1 - i)) & 1 for i in range(width))

    def payload(self):
        bits = self._bits + [0] * (-len(self._bits) % 8)
        return bytes(
            int("".join(map(str, bits[i : i + 8])), 2) for i in range(0, len(bits), 8)
        )


def _descriptor_pair(code):
    f, x, y = code // 100000, (code // 1000) % 100, code % 1000
    return ((f << 14) | (x << 8) | y).to_bytes(2)


def _encode_imfr27(
    *,
    observed=(2026, 7, 16, 12, 50, 0),
    codes=(2047, 310, 525, 1100),
    heights=None,
    rows=2,
    cols=2,
    reference=-400,
    descriptors=None,
    trailing_garbage=False,
):
    """Encode un message IMFR27 miniature, bit a bit, au format reel."""

    year, month, day, hour, minute, second = observed
    w = _BitWriter()
    w.write(0, 248); w.write(0, 4); w.write(0, 8)          # 001099/030031/001192
    for v, width in ((year, 12), (month, 4), (day, 6), (hour, 5), (minute, 6), (second, 6)):
        w.write(v, width)                                   # 301011 + 301013
    w.write(0, 5); w.write(0, 12); w.write(0, 13); w.write(0, 3)
    w.write(1, 3)                                           # 029001 stereo polaire
    w.write(rows, 12); w.write(cols, 12)                    # 030021/030022
    w.write(100, 16); w.write(100, 16)                      # 1000 m (echelle -1)
    w.write(5367000 + 9000000, 25)                          # origine lat 53.67
    w.write(-996500 + 18000000, 26)                         # origine lon -9.965
    w.write(0 + 18000000, 26)                               # meridien 0
    w.write(0, 8); w.write(224, 8)                          # 005194 / 030192
    w.write(4500000 + 9000000, 25)                          # lat_ts 45
    w.write(0, 6)                                           # 029192 WGS84
    w.write(0, 16); w.write(0, 16); w.write(0, 8)
    w.write(0, 4); w.write(0, 4); w.write(0, 2)
    w.write(1, 8)                                           # 1 station
    w.write(0, 7); w.write(0, 10)
    for v, width in ((year, 12), (month, 4), (day, 6), (hour, 5), (minute, 6), (second, 6)):
        w.write(v, width)
    w.write(4991360 + 9000000, 25); w.write(550440 + 18000000, 26)
    w.write(0, 16); w.write(0, 10)
    w.write(3, 8); w.write(0, 3)                            # calage interne
    w.write(2, 8); w.write(0, 2)                            # calage final
    count = rows * cols
    w.write(count, 32)
    for _ in range(count):
        w.write(0, 10)                                      # probabilite pluie
    w.write(count, 32)
    for height_code in (heights if heights is not None else [0] * count):
        w.write(height_code, 12)                            # echo tops
    ref_field = ((1 << 10) | abs(reference)) if reference < 0 else reference
    w.write(ref_field, 11)                                  # 203011
    w.write(count, 32)
    for code in codes:
        w.write(code, 11)                                   # reflectivite
    payload = w.payload()
    if trailing_garbage:
        payload += b"\xff"

    descs = descriptors if descriptors is not None else LIVE_UNEXPANDED_DESCRIPTORS
    s3 = (7 + 2 * len(descs)).to_bytes(3) + b"\x00" + (1).to_bytes(2) + bytes([0b1000_0000])
    for code in descs:
        s3 += _descriptor_pair(code)
    s1 = (
        (22).to_bytes(3) + bytes([0]) + (85).to_bytes(2) + (0).to_bytes(2)
        + bytes([0, 0, 6, 0, 27, 16, 14]) + year.to_bytes(2)
        + bytes([month, day, hour, minute, second])
    )
    s4 = (4 + len(payload)).to_bytes(3) + b"\x00" + payload
    total = 8 + len(s1) + len(s3) + len(s4) + 4
    return b"BUFR" + total.to_bytes(3) + bytes([4]) + s1 + s3 + s4 + b"7777"


def _write_fixture(tmp_path, **kwargs):
    fixture = tmp_path / "live-imfr27.bufr"
    fixture.write_bytes(_encode_imfr27(**kwargs))
    return fixture


def test_decode_bufr_accepts_live_pure_bufr_shape(tmp_path, monkeypatch):
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    fixture = _write_fixture(tmp_path)

    grid = decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")

    assert grid["values"] == [None, -9.0, 12.5, 70.0]
    assert grid["width"] == 2
    assert grid["height"] == 2
    assert grid["projection"]["latitudeOfTrueScale"] == 45.0
    assert grid["upperLeftProjected"] == pytest.approx(
        [-619652.074, -3526818.338], abs=0.01
    )


def test_decode_bufr_rejects_catalogue_timestamp_mismatch(tmp_path, monkeypatch):
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    fixture = _write_fixture(tmp_path, observed=(2026, 7, 16, 12, 45, 0))

    with pytest.raises(RadarMetadataError, match="timestamp"):
        decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")


def test_decode_bufr_rejects_foreign_descriptor_sequence(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    altered = list(LIVE_UNEXPANDED_DESCRIPTORS)
    altered[altered.index(21120)] = 21121
    fixture = _write_fixture(tmp_path, descriptors=altered)

    with pytest.raises(RadarMetadataError, match="IMFR27"):
        decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")


def test_decode_bufr_rejects_unexpected_reference_value(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    fixture = _write_fixture(tmp_path, reference=-300)

    with pytest.raises(RadarMetadataError, match="reference"):
        decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")


def test_decode_bufr_rejects_trailing_garbage(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    fixture = _write_fixture(tmp_path, trailing_garbage=True)

    with pytest.raises(RadarMetadataError, match="trailing"):
        decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")


def test_decode_bufr_rejects_out_of_range_reflectivity(tmp_path, monkeypatch):
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    fixture = _write_fixture(tmp_path, codes=(2047, 310, 200, 1100))

    with pytest.raises(RadarMetadataError, match="unsupported horizontal reflectivity"):
        decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")


def test_decode_bufr_exposes_echo_top_heights(tmp_path, monkeypatch):
    monkeypatch.setattr(bufr_decoder, "GRID_SIZE", 2)
    monkeypatch.setattr(models, "GRID_SIZE", 2)
    # 010002 : largeur 12 (201124), échelle -1, référence -40 => (brut-40)×10 m
    fixture = _write_fixture(tmp_path, heights=(4095, 40, 190, 1240))

    grid = decode_bufr(fixture, observed_at="2026-07-16T12:50:00Z")

    assert grid["echoTops"] == [None, 0.0, 1500.0, 12000.0]


def test_render_echo_tops_altitude_ramp(tmp_path):
    from render import render_echo_tops

    output = tmp_path / "echotops.webp"

    render_echo_tops([None, 500.0, 4500.0, 9500.0], width=2, height=2, output=output)

    from PIL import Image

    with Image.open(output) as image:
        assert image.mode == "RGBA"
        assert image.getpixel((0, 0))[3] == 0          # manquant -> transparent
        low = image.getpixel((1, 0))
        mid = image.getpixel((0, 1))
        high = image.getpixel((1, 1))
        assert low[3] > 0 and mid[3] > 0 and high[3] > 0
        assert low[:3] != high[:3]                     # rampe: couleurs distinctes
