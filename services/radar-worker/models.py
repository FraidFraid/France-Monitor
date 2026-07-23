"""Validated radar grid and public manifest models."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, TypedDict

from pyproj import CRS, Transformer


PRODUCT_ID = "IMFR27_C_LFPW"
GRID_SIZE = 1536
SOURCE = "Météo-France DPRadar"
LICENSE = "Licence Ouverte 2.0"


class Radar2dManifest(TypedDict):
    schemaVersion: int
    source: str
    observedAt: str
    generatedAt: str
    bounds: list[float]
    imageUrl: str
    resolutionMeters: int
    license: str


class RadarMetadataError(ValueError):
    """Raised when a scientific metadata field is absent or unsupported."""


def _required(mapping: Mapping[str, Any], key: str) -> Any:
    if key not in mapping or mapping[key] is None:
        raise RadarMetadataError(f"required radar metadata is absent: {key}")
    return mapping[key]


def validate_grid(grid: Mapping[str, Any]) -> None:
    if _required(grid, "productId") != PRODUCT_ID:
        raise RadarMetadataError(f"unexpected radar product; expected {PRODUCT_ID}")
    width = int(_required(grid, "width"))
    height = int(_required(grid, "height"))
    if (width, height) != (GRID_SIZE, GRID_SIZE):
        raise RadarMetadataError(
            f"unexpected radar dimensions {width}x{height}; expected {GRID_SIZE}x{GRID_SIZE}"
        )
    if int(_required(grid, "resolutionMeters")) != 1000:
        raise RadarMetadataError("unexpected radar resolution; expected 1000 metres")


def projected_crs(grid: Mapping[str, Any]) -> CRS:
    projection = _required(grid, "projection")
    if not isinstance(projection, Mapping):
        raise RadarMetadataError("projection metadata must be an object")
    if _required(projection, "type") != "polar_stereographic":
        raise RadarMetadataError("only the declared polar stereographic product is supported")
    if _required(projection, "geodeticDatum") != "WGS84":
        raise RadarMetadataError("the radar product must explicitly declare WGS84")
    if _required(projection, "projectionCenter") != "north_pole":
        raise RadarMetadataError("the polar projection centre must be explicitly north_pole")

    lat_0 = float(_required(projection, "latitudeOfOrigin"))
    lat_ts = float(_required(projection, "latitudeOfTrueScale"))
    lon_0 = float(_required(projection, "centralMeridian"))
    false_easting = float(_required(projection, "falseEasting"))
    false_northing = float(_required(projection, "falseNorthing"))
    if lat_0 != 90.0:
        raise RadarMetadataError("north-pole stereographic latitude of origin must be 90°")

    return CRS.from_proj4(
        "+proj=stere +lat_0={lat_0} +lat_ts={lat_ts} +lon_0={lon_0} "
        "+x_0={x_0} +y_0={y_0} +datum=WGS84 +units=m +no_defs".format(
            lat_0=lat_0,
            lat_ts=lat_ts,
            lon_0=lon_0,
            x_0=false_easting,
            y_0=false_northing,
        )
    )


def wgs84_bounds(grid: Mapping[str, Any]) -> list[float]:
    validate_grid(grid)
    upper_left = _required(grid, "upperLeftProjected")
    if not isinstance(upper_left, list) or len(upper_left) != 2:
        raise RadarMetadataError("upperLeftProjected must contain x and y")
    x_min, y_max = (float(value) for value in upper_left)
    resolution = float(grid["resolutionMeters"])
    x_max = x_min + int(grid["width"]) * resolution
    y_min = y_max - int(grid["height"]) * resolution

    transform = Transformer.from_crs(projected_crs(grid), CRS.from_epsg(4326), always_xy=True)
    corners = [
        transform.transform(x_min, y_min),
        transform.transform(x_min, y_max),
        transform.transform(x_max, y_min),
        transform.transform(x_max, y_max),
    ]
    if not all(-180 <= lon <= 180 and -90 <= lat <= 90 for lon, lat in corners):
        raise RadarMetadataError("projection metadata produced invalid WGS84 bounds")
    return [
        round(min(lon for lon, _ in corners), 6),
        round(min(lat for _, lat in corners), 6),
        round(max(lon for lon, _ in corners), 6),
        round(max(lat for _, lat in corners), 6),
    ]


def _utc_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise RadarMetadataError("radar timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def build_manifest(
    grid: Mapping[str, Any],
    *,
    public_base_url: str,
    image_name: str | None = None,
    generated_at: str | None = None,
) -> Radar2dManifest:
    observed_at = str(_required(grid, "observedAt"))
    observed = _utc_timestamp(observed_at)
    generated = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    generated_utc = _utc_timestamp(generated)
    version = observed.strftime("%Y%m%dT%H%MZ")
    raster_name = image_name or f"radar-{version}.webp"
    return {
        "schemaVersion": 1,
        "source": SOURCE,
        "observedAt": observed.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generatedAt": generated_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bounds": wgs84_bounds(grid),
        "imageUrl": f"{public_base_url.rstrip('/')}/rasters/{raster_name}",
        "resolutionMeters": int(grid["resolutionMeters"]),
        "license": LICENSE,
    }
