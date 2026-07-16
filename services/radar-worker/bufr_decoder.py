"""Strict decoder for the Météo-France metropolitan reflectivity mosaic."""

from __future__ import annotations

from collections.abc import Iterable
import os
from pathlib import Path
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


def decode_bufr(path: Path, *, observed_at: str) -> dict[str, Any]:
    """Decode a real DPRadar BUFR file, rejecting incomplete scientific metadata."""

    payload = path.read_bytes()
    if PRODUCT_ID.encode("ascii") not in payload[:512]:
        raise RadarMetadataError(f"BUFR bulletin does not declare product {PRODUCT_ID}")
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
                    eccodes.codes_set(handle, "unpack", 1)
                    iterator = eccodes.codes_bufr_keys_iterator_new(handle)
                    message_codes: set[str] = set()
                    message_pixels: list[Sequence[int]] = []
                    while eccodes.codes_bufr_keys_iterator_next(iterator):
                        key = eccodes.codes_bufr_keys_iterator_get_name(iterator)
                        code = _descriptor_code(eccodes, handle, key)
                        if code is None:
                            continue
                        message_codes.add(code)
                        if code == "030002":
                            values = eccodes.codes_get_array(handle, key)
                            if len(values) == GRID_SIZE * GRID_SIZE:
                                message_pixels.append(values)
                        elif code in REQUIRED_DESCRIPTORS:
                            value = eccodes.codes_get(handle, key)
                            if code in descriptors and descriptors[code] != value:
                                raise RadarMetadataError(
                                    f"conflicting values for BUFR descriptor {code}"
                                )
                            descriptors[code] = value
                    reflects = bool(message_codes & {"021001", "021216", "021219"})
                    if reflects:
                        candidates.extend(message_pixels)
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
            "BUFR must contain exactly one 1536x1536 pixel field explicitly qualified as reflectivity"
        )
    return grid_from_descriptors(
        descriptors,
        pixel_codes=candidates[0],
        product_id=PRODUCT_ID,
        observed_at=observed_at,
    )
