"""Authenticated discovery and download client for Météo-France DPRadar."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import os
from pathlib import Path
import tempfile
from typing import Any, Iterable, Mapping
from urllib.parse import parse_qs, urlparse

import httpx

from models import RadarMetadataError


BASE_URL = "https://public-api.meteofrance.fr/public/DPRadar/v1"
PRODUCT_PATH = "/public/DPRadar/v1/mosaiques/METROPOLE/observations/REFLECTIVITE/produit"
PRODUCT_PATH_LEGACY = "/public/DPRadar/mosaiques/METROPOLE/observations/REFLECTIVITE/produit"
MAX_PRODUCT_AGE = timedelta(hours=20)
MAX_COMPRESSED_BYTES = 64 * 1024 * 1024
MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024


@dataclass(frozen=True)
class LatestProduct:
    url: str
    observed_at: str


def archive_validated_product(
    candidate: Path,
    product: LatestProduct,
    data_dir: Path,
) -> Path:
    """Archive a successfully decoded candidate under an immutable content name."""

    raw_dir = data_dir.resolve() / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with candidate.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    observed = datetime.fromisoformat(product.observed_at.replace("Z", "+00:00"))
    if observed.tzinfo is None:
        raise RadarMetadataError("radar catalogue validity_time has no timezone")
    version = observed.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
    destination = raw_dir / f"radar-{version}-{digest.hexdigest()}.bufr"
    try:
        os.link(candidate, destination)
    except FileExistsError:
        pass
    return destination


def _links(document: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(document, list):
        values = document
    elif isinstance(document, Mapping):
        values = document.get("links", document.get("items", []))
    else:
        values = []
    return (value for value in values if isinstance(value, Mapping))


def select_product_link(document: Any) -> LatestProduct:
    matches: list[LatestProduct] = []
    for link in _links(document):
        href = str(link.get("href", ""))
        parsed = urlparse(href)
        query = parse_qs(parsed.query)
        if (
            parsed.scheme == "https"
            and parsed.netloc == "public-api.meteofrance.fr"
            and parsed.path in {PRODUCT_PATH, PRODUCT_PATH_LEGACY}
            and query == {"maille": ["1000"]}
        ):
            validity = link.get("validity_time")
            if not isinstance(validity, str):
                raise RadarMetadataError("radar catalogue product lacks validity_time")
            matches.append(LatestProduct(url=href, observed_at=validity))
    if len(matches) != 1:
        raise RadarMetadataError("catalogue must expose exactly one METROPOLE REFLECTIVITE 1000m product")
    return matches[0]


class RadarApiClient:
    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("METEO_FRANCE_RADAR_API_KEY is required")
        self._headers = {"apikey": api_key, "Accept": "application/json"}

    def _get_json(self, path: str) -> Any:
        response = httpx.get(f"{BASE_URL}{path}", headers=self._headers, timeout=15.0)
        response.raise_for_status()
        return response.json()

    @staticmethod
    def _requires_link(document: Any, suffix: str) -> None:
        if not any(urlparse(str(link.get("href", ""))).path.endswith(suffix) for link in _links(document)):
            raise RadarMetadataError(f"radar catalogue does not expose required resource: {suffix}")

    def discover_latest(self, *, now: datetime | None = None) -> LatestProduct:
        zones = self._get_json("/mosaiques")
        self._requires_link(zones, "/mosaiques/METROPOLE")
        observations = self._get_json("/mosaiques/METROPOLE/observations")
        self._requires_link(observations, "/mosaiques/METROPOLE/observations/REFLECTIVITE")
        product = select_product_link(
            self._get_json("/mosaiques/METROPOLE/observations/REFLECTIVITE")
        )
        observed = datetime.fromisoformat(product.observed_at.replace("Z", "+00:00"))
        if observed.tzinfo is None:
            raise RadarMetadataError("radar catalogue validity_time has no timezone")
        current = now or datetime.now(timezone.utc)
        age = current.astimezone(timezone.utc) - observed.astimezone(timezone.utc)
        if age < timedelta(minutes=-10) or age > MAX_PRODUCT_AGE:
            raise RadarMetadataError(f"radar observation age is outside the accepted 20-hour window: {age}")
        return product

    def download(self, product: LatestProduct, data_dir: Path) -> Path:
        data_dir = data_dir.resolve()
        raw_dir = data_dir / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        compressed_path: Path | None = None
        output_path: Path | None = None
        completed = False
        try:
            with tempfile.NamedTemporaryFile(
                dir=raw_dir, prefix=".download-", suffix=".tmp", delete=False
            ) as compressed_stream:
                compressed_path = Path(compressed_stream.name)
                size = 0
                with httpx.stream(
                    "GET",
                    product.url,
                    headers={**self._headers, "Accept": "application/octet-stream"},
                    timeout=60.0,
                ) as response:
                    response.raise_for_status()
                    for chunk in response.iter_bytes():
                        if size + len(chunk) > MAX_COMPRESSED_BYTES:
                            raise RadarMetadataError(
                                "compressed radar product exceeds safety limit"
                            )
                        compressed_stream.write(chunk)
                        size += len(chunk)
                compressed_stream.flush()
                os.fsync(compressed_stream.fileno())

            with tempfile.NamedTemporaryFile(
                dir=raw_dir, prefix=".candidate-", suffix=".tmp", delete=False
            ) as output_stream:
                output_path = Path(output_stream.name)
                with compressed_path.open("rb") as source:
                    magic = source.read(2)
                    source.seek(0)
                    reader = gzip.GzipFile(fileobj=source) if magic == b"\x1f\x8b" else source
                    expanded = 0
                    try:
                        while chunk := reader.read(1024 * 1024):
                            if expanded + len(chunk) > MAX_DECOMPRESSED_BYTES:
                                raise RadarMetadataError(
                                    "decompressed radar product exceeds safety limit"
                                )
                            output_stream.write(chunk)
                            expanded += len(chunk)
                    finally:
                        if reader is not source:
                            reader.close()
                output_stream.flush()
                os.fsync(output_stream.fileno())

            with output_path.open("rb") as stream:
                prefix = stream.read(1024)
            if b"BUFR" not in prefix:
                raise RadarMetadataError("downloaded radar product contains no BUFR bulletin")
            completed = True
            return output_path
        except (gzip.BadGzipFile, EOFError) as exc:
            raise RadarMetadataError("radar product is not a valid gzip stream") from exc
        finally:
            if compressed_path is not None:
                compressed_path.unlink(missing_ok=True)
            if not completed and output_path is not None:
                output_path.unlink(missing_ok=True)
