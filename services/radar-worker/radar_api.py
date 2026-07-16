"""Authenticated discovery and download client for Météo-France DPRadar."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import gzip
import io
import os
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import parse_qs, urlparse

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
        self._headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}

    def _get_json(self, path: str) -> Any:
        import httpx

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
        import httpx

        data_dir = data_dir.resolve()
        raw_dir = data_dir / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        response = httpx.get(
            product.url,
            headers={**self._headers, "Accept": "application/octet-stream"},
            timeout=60.0,
        )
        response.raise_for_status()
        compressed = response.content
        if len(compressed) > MAX_COMPRESSED_BYTES:
            raise RadarMetadataError("compressed radar product exceeds safety limit")
        try:
            if compressed.startswith(b"\x1f\x8b"):
                with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
                    payload = stream.read(MAX_DECOMPRESSED_BYTES + 1)
            else:
                payload = compressed
        except gzip.BadGzipFile as exc:
            raise RadarMetadataError("radar product is not a valid gzip stream") from exc
        if len(payload) > MAX_DECOMPRESSED_BYTES:
            raise RadarMetadataError("decompressed radar product exceeds safety limit")
        if b"BUFR" not in payload[:1024]:
            raise RadarMetadataError("downloaded radar product contains no BUFR bulletin")

        temporary = raw_dir / ".latest.bufr.tmp"
        destination = raw_dir / "latest.bufr"
        with temporary.open("wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
        return destination
