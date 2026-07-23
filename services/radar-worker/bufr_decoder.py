"""Strict decoder for the Météo-France metropolitan reflectivity mosaic."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
import math
import os
from pathlib import Path
from typing import Any, Mapping, Sequence

from pyproj import CRS, Transformer

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
    "005194",  # projection centre indicator
    "005195",  # reference latitude
    "006198",  # meridian parallel to y axis
    "030192",  # scanning mode
    "005001",  # latitude of the north-west grid origin
    "006001",  # longitude of the north-west grid origin
)
METEO_FRANCE_CENTRE = 85
EXPECTED_MASTER_TABLE = 16
EXPECTED_LOCAL_TABLE = 14
EXPECTED_DATA_CATEGORY = 6
EXPECTED_DATA_SUBCATEGORY = 27
EXPECTED_SCANNING_MODE = 224
EXPECTED_NW_ORIGIN = (-9.965, 53.67)
REQUIRED_UNEXPANDED_DESCRIPTORS = {
    30021,  # pixels per row
    30022,  # pixels per column
    5033,   # horizontal pixel size 1
    6033,   # horizontal pixel size 2
    329192, # Météo-France projection definition
    29192,  # Météo-France geodetic system
    30032,  # projection type
    21120,  # radar data field qualifier
    21001,  # horizontal reflectivity
}


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
    pixel_codes: Sequence[float | None],
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
    if int(descriptors["030192"]) != EXPECTED_SCANNING_MODE:
        raise RadarMetadataError(
            f"unexpected BUFR scanning mode; expected {EXPECTED_SCANNING_MODE}"
        )

    x_resolution = int(descriptors["005033"])
    y_resolution = int(descriptors["006033"])
    if x_resolution != y_resolution:
        raise RadarMetadataError("radar pixel resolutions differ between projected axes")

    projection = {
        "type": "polar_stereographic",
        "geodeticDatum": "WGS84",
        "projectionCenter": "north_pole",
        "latitudeOfOrigin": 90.0,
        "latitudeOfTrueScale": float(descriptors["005195"]),
        "centralMeridian": float(descriptors["006198"]),
        "falseEasting": 0.0,
        "falseNorthing": 0.0,
    }
    crs = CRS.from_proj4(
        "+proj=stere +lat_0=90 +lat_ts={lat_ts} +lon_0={lon_0} "
        "+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs".format(
            lat_ts=projection["latitudeOfTrueScale"],
            lon_0=projection["centralMeridian"],
        )
    )
    transformer = Transformer.from_crs(CRS.from_epsg(4326), crs, always_xy=True)
    upper_left = transformer.transform(
        float(descriptors["006001"]),
        float(descriptors["005001"]),
    )

    grid: dict[str, Any] = {
        "productId": product_id,
        "observedAt": observed_at,
        "width": int(descriptors["030021"]),
        "height": int(descriptors["030022"]),
        "resolutionMeters": x_resolution,
        "projection": projection,
        "upperLeftProjected": [float(upper_left[0]), float(upper_left[1])],
        "values": pixel_codes,
    }
    validate_grid(grid)
    expected_count = GRID_SIZE * GRID_SIZE
    if len(pixel_codes) != expected_count:
        raise RadarMetadataError(
            f"reflectivity raster has {len(pixel_codes)} pixels; expected {expected_count}"
        )
    return grid


def _validate_bufr_prefix(path: Path) -> None:
    with path.open("rb") as stream:
        prefix = stream.read(4)
    if prefix != b"BUFR":
        raise RadarMetadataError("radar payload must start with a raw BUFR message")


def _utc_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RadarMetadataError("catalogue radar timestamp is invalid") from exc
    if parsed.tzinfo is None:
        raise RadarMetadataError("catalogue radar timestamp must include a timezone")
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def _normalize_reflectivity(values: Sequence[float]) -> list[float | None]:
    normalized: list[float | None] = []
    for raw_value in values:
        value = float(raw_value)
        if not math.isfinite(value) or value <= -1e90 or value == 9999:
            normalized.append(None)
        elif value == -40.0 or -9.0 <= value <= 70.0:
            normalized.append(value)
        else:
            raise RadarMetadataError(f"unsupported horizontal reflectivity value: {value}")
    return normalized


def decode_bufr(path: Path, *, observed_at: str) -> dict[str, Any]:
    """Decode a real DPRadar BUFR file, rejecting incomplete scientific metadata."""

    _validate_bufr_prefix(path)
    try:
        import eccodes  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RadarMetadataError("ecCodes Python bindings are required to decode radar BUFR") from exc

    handle = None
    try:
        with path.open("rb") as stream:
            handle = eccodes.codes_bufr_new_from_file(stream)
            if handle is None:
                raise RadarMetadataError("radar payload contains no BUFR message")

            header_expectations = {
                "bufrHeaderCentre": METEO_FRANCE_CENTRE,
                "masterTablesVersionNumber": EXPECTED_MASTER_TABLE,
                "localTablesVersionNumber": EXPECTED_LOCAL_TABLE,
                "dataCategory": EXPECTED_DATA_CATEGORY,
                "dataSubCategory": EXPECTED_DATA_SUBCATEGORY,
                "numberOfSubsets": 1,
                "compressedData": 0,
            }
            for key, expected in header_expectations.items():
                actual = int(eccodes.codes_get(handle, key))
                if actual != expected:
                    raise RadarMetadataError(
                        f"unexpected BUFR {key}: {actual}; expected {expected}"
                    )

            eccodes.codes_set(handle, "unpack", 1)
            unexpanded = {
                int(value)
                for value in eccodes.codes_get_array(handle, "unexpandedDescriptors")
            }
            if not REQUIRED_UNEXPANDED_DESCRIPTORS <= unexpanded:
                raise RadarMetadataError("BUFR descriptor structure is not the IMFR27 mosaic")

            observed_inside = datetime(
                int(eccodes.codes_get(handle, "year")),
                int(eccodes.codes_get(handle, "month")),
                int(eccodes.codes_get(handle, "day")),
                int(eccodes.codes_get(handle, "hour")),
                int(eccodes.codes_get(handle, "minute")),
                int(eccodes.codes_get(handle, "second")),
                tzinfo=timezone.utc,
            )
            if observed_inside != _utc_timestamp(observed_at):
                raise RadarMetadataError(
                    "BUFR observation timestamp does not match the DPRadar catalogue"
                )

            latitudes = eccodes.codes_get_array(handle, "latitude")
            longitudes = eccodes.codes_get_array(handle, "longitude")
            if len(latitudes) == 0 or len(latitudes) != len(longitudes):
                raise RadarMetadataError("BUFR grid origin coordinates are absent")
            origin = (float(longitudes[0]), float(latitudes[0]))
            if not (
                math.isclose(origin[0], EXPECTED_NW_ORIGIN[0], abs_tol=1e-6)
                and math.isclose(origin[1], EXPECTED_NW_ORIGIN[1], abs_tol=1e-6)
            ):
                raise RadarMetadataError("unexpected IMFR27 north-west grid origin")

            descriptors = {
                "029001": eccodes.codes_get(handle, "projectionType"),
                "029192": eccodes.codes_get(handle, "meteoFranceLocal029192"),
                "030021": eccodes.codes_get(handle, "numberOfPixelsPerRow"),
                "030022": eccodes.codes_get(handle, "numberOfPixelsPerColumn"),
                "005033": eccodes.codes_get(handle, "pixelSizeOnHorizontal1"),
                "006033": eccodes.codes_get(handle, "pixelSizeOnHorizontal2"),
                "005194": eccodes.codes_get(handle, "meteoFranceLocal005194"),
                "005195": eccodes.codes_get(handle, "meteoFranceLocal005195"),
                "006198": eccodes.codes_get(handle, "meteoFranceLocal006198"),
                "030192": eccodes.codes_get(handle, "meteoFranceLocal030192"),
                "005001": origin[1],
                "006001": origin[0],
            }
            values = _normalize_reflectivity(
                eccodes.codes_get_array(handle, "horizontalReflectivity")
            )
            extra_handle = eccodes.codes_bufr_new_from_file(stream)
            if extra_handle is not None:
                eccodes.codes_release(extra_handle)
                raise RadarMetadataError("radar payload must contain exactly one BUFR message")
    except RadarMetadataError:
        raise
    except Exception as exc:
        raise RadarMetadataError(f"ecCodes could not decode radar BUFR: {exc}") from exc
    finally:
        if handle is not None:
            eccodes.codes_release(handle)

    return grid_from_descriptors(
        descriptors,
        pixel_codes=values,
        product_id=PRODUCT_ID,
        observed_at=observed_at,
    )
