"""Strict decoder for the Météo-France metropolitan reflectivity mosaic."""

from __future__ import annotations

from collections.abc import Iterable
import os
from pathlib import Path
import re
from typing import Any, Mapping, Sequence

from models import GRID_SIZE, PRODUCT_ID, RadarMetadataError, validate_grid


LOCAL_DEFINITIONS = Path(__file__).parent / "eccodes-definitions"
if LOCAL_DEFINITIONS.is_dir():
    os.environ.setdefault(
        "ECCODES_DEFINITION_PATH",
        f"{LOCAL_DEFINITIONS}:/MEMFS/definitions",
    )


REQUIRED_DESCRIPTORS = (
    "029001",  # WMO projection type
    "029192",  # Météo-France local geodetic system
    "030021",  # pixels per row
    "030022",  # pixels per column
    "005033",  # horizontal pixel size 1
    "006033",  # horizontal pixel size 2
    "005193",  # NW x on projection plane
    "006197",  # NW y on projection plane
    "005194",  # projection centre indicator
    "005195",  # reference latitude
    "006198",  # meridian parallel to y axis
)
GTS_HEADER = re.compile(
    rb"(?:^|[\x01\r\n])(?P<ttaaii>[A-Z]{4}\d{2})[ \t]+"
    rb"(?P<cccc>[A-Z]{4})[ \t]+(?P<yygggg>\d{6})"
    rb"(?:[ \t]+[A-Z]{3})?[ \t]*(?:\r\r\n|\r\n|\n)$"
)
PRODUCT_TTAAII = b"IMFR27"
PRODUCT_ORIGIN = b"LFPW"
METEO_FRANCE_CENTRE = 85


def decode_reflectivity_codes(codes: Iterable[int]) -> list[float | None]:
    """Convert DPRadar pixel codes to dBZ without conflating missing data."""

    return [decode_reflectivity_code(code) for code in codes]


def decode_reflectivity_code(code: int) -> float | None:
    if 0 <= code <= 160:
        # Codes 159/160 are the documented upper-bin saturation.
        return min(70.0, -9.0 + code * 0.5)
    if code == 161:
        return -40.0
    if code == 255:
        return None
    raise ValueError(f"unsupported reflectivity code: {code}")


def grid_from_descriptors(
    descriptors: Mapping[str, Any],
    *,
    pixel_codes: Sequence[int],
    product_id: str,
    observed_at: str,
) -> dict[str, Any]:
    """Build a grid only from an explicitly complete BUFR descriptor set."""

    for descriptor in REQUIRED_DESCRIPTORS:
        if descriptor not in descriptors or descriptors[descriptor] is None:
            raise RadarMetadataError(f"required BUFR descriptor is absent: {descriptor}")

    if int(descriptors["029001"]) != 1:
        raise RadarMetadataError("BUFR 029001 must declare polar stereographic projection (code 1)")
    if int(descriptors["029192"]) != 0:
        raise RadarMetadataError("BUFR 029192 must explicitly declare the WGS84 profile (code 0)")
    if int(descriptors["005194"]) != 0:
        raise RadarMetadataError("BUFR 005194 must explicitly declare the north projection centre")

    x_resolution = int(descriptors["005033"])
    y_resolution = int(descriptors["006033"])
    if x_resolution != y_resolution:
        raise RadarMetadataError("radar pixel resolutions differ between projected axes")

    grid: dict[str, Any] = {
        "productId": product_id,
        "observedAt": observed_at,
        "width": int(descriptors["030021"]),
        "height": int(descriptors["030022"]),
        "resolutionMeters": x_resolution,
        "projection": {
            "type": "polar_stereographic",
            "geodeticDatum": "WGS84",
            "projectionCenter": "north_pole",
            "latitudeOfOrigin": 90.0,
            "latitudeOfTrueScale": float(descriptors["005195"]),
            "centralMeridian": float(descriptors["006198"]),
            "falseEasting": 0.0,
            "falseNorthing": 0.0,
        },
        "upperLeftProjected": [
            float(descriptors["005193"]),
            float(descriptors["006197"]),
        ],
        "values": pixel_codes,
    }
    validate_grid(grid)
    expected_count = GRID_SIZE * GRID_SIZE
    if len(pixel_codes) != expected_count:
        raise RadarMetadataError(
            f"reflectivity raster has {len(pixel_codes)} pixels; expected {expected_count}"
        )
    return grid


def _descriptor_code(eccodes: Any, handle: Any, key: str) -> str | None:
    try:
        raw = str(eccodes.codes_get(handle, f"{key}->code"))
    except Exception:
        return None
    digits = "".join(character for character in raw if character.isdigit())
    return digits.zfill(6) if digits else None


def _base_key(key: str) -> str:
    return key.rsplit("#", 1)[-1]


def _validate_gts_header(path: Path) -> None:
    with path.open("rb") as stream:
        payload = stream.read(1024)
    bufr_offset = payload.find(b"BUFR")
    if bufr_offset < 0:
        raise RadarMetadataError("radar payload contains no BUFR message")
    header = GTS_HEADER.search(payload[max(0, bufr_offset - 256) : bufr_offset])
    if (
        header is None
        or header.group("ttaaii") != PRODUCT_TTAAII
        or header.group("cccc") != PRODUCT_ORIGIN
    ):
        raise RadarMetadataError(
            "structured GTS header must identify the exact IMFR27 LFPW radar product"
        )


def decode_bufr(path: Path, *, observed_at: str) -> dict[str, Any]:
    """Decode a real DPRadar BUFR file, rejecting incomplete scientific metadata."""

    _validate_gts_header(path)
    try:
        import eccodes  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RadarMetadataError("ecCodes Python bindings are required to decode radar BUFR") from exc

    descriptors: dict[str, Any] = {}
    candidates: list[Sequence[int]] = []
    try:
        with path.open("rb") as stream:
            while True:
                handle = eccodes.codes_bufr_new_from_file(stream)
                if handle is None:
                    break
                iterator = None
                try:
                    if int(eccodes.codes_get(handle, "bufrHeaderCentre")) != METEO_FRANCE_CENTRE:
                        raise RadarMetadataError("BUFR centre must identify Météo-France (85)")
                    eccodes.codes_set(handle, "unpack", 1)
                    unexpanded = {
                        int(value)
                        for value in eccodes.codes_get_array(handle, "unexpandedDescriptors")
                    }
                    iterator = eccodes.codes_bufr_keys_iterator_new(handle)
                    message_codes: set[str] = set()
                    keys_by_code: dict[str, str] = {}
                    while eccodes.codes_bufr_keys_iterator_next(iterator):
                        key = eccodes.codes_bufr_keys_iterator_get_name(iterator)
                        code = _descriptor_code(eccodes, handle, key)
                        if code is None:
                            continue
                        message_codes.add(code)
                        keys_by_code.setdefault(code, _base_key(key))
                        if code in REQUIRED_DESCRIPTORS:
                            value = eccodes.codes_get(handle, key)
                            if code in descriptors and descriptors[code] != value:
                                raise RadarMetadataError(
                                    f"conflicting values for BUFR descriptor {code}"
                                )
                            descriptors[code] = value
                    if 321193 in unexpanded and {"030001", "021216"} <= message_codes:
                        pixels = eccodes.codes_get_array(handle, keys_by_code["030001"])
                        reflectivity = eccodes.codes_get_array(handle, keys_by_code["021216"])
                        if (
                            len(pixels) == GRID_SIZE * GRID_SIZE
                            and len(reflectivity) == len(pixels) * 2
                        ):
                            candidates.append([int(value) for value in pixels])
                finally:
                    if iterator is not None:
                        eccodes.codes_bufr_keys_iterator_delete(iterator)
                    eccodes.codes_release(handle)
    except RadarMetadataError:
        raise
    except Exception as exc:
        raise RadarMetadataError(f"ecCodes could not decode radar BUFR: {exc}") from exc

    if len(candidates) != 1:
        raise RadarMetadataError(
            "BUFR must contain exactly one 321193 pixel field with paired 021216 reflectivity values"
        )
    return grid_from_descriptors(
        descriptors,
        pixel_codes=candidates[0],
        product_id=PRODUCT_ID,
        observed_at=observed_at,
    )
