"""Cache des volumes PAM par station/cycle et extraction de colonnes.

Un « volume » = les scans ZH des tours exposés par le catalogue PAM d'une
station à l'instant T. Cache mémoire par station : le catalogue n'est
revalidé auprès de l'API amont qu'au plus une fois toutes les
CATALOG_TTL_SECONDS (le cycle antenne dure ~5 min, inutile de marteler le
catalogue à chaque appel de column()) ; la clé de cycle (tuple des
validity_time exposés) détecte alors un nouveau tour et invalide le volume
mis en cache. Verrou par station : un seul téléchargement concurrent.
"""
from __future__ import annotations

import gzip
import threading
import time
from dataclasses import dataclass

import httpx

from models import LICENSE, RadarMetadataError, SOURCE
from pam_bitstream import PolarScanZh, parse_zh_scan, select_zh_message, split_messages
from polar_geometry import column_sample, great_circle_distance_m
from station_catalog import STATIONS, nearest_station

BASE_URL = "https://public-api.meteofrance.fr/public/DPRadar/v1"
MAX_TOURS = 8
# Le cycle antenne dure ~5 min ; revalider le catalogue au plus toutes les
# 30 s détecte un nouveau cycle sans re-fetch à chaque requête /volume/column.
CATALOG_TTL_SECONDS = 30.0


class OutOfRangeError(Exception):
    def __init__(self, nearest_station_id: int, nearest_km: float) -> None:
        super().__init__("point outside radar coverage")
        self.nearest_station_id = nearest_station_id
        self.nearest_km = nearest_km


@dataclass(frozen=True)
class _CachedVolume:
    cycle_key: tuple[str, ...]
    scans: tuple[PolarScanZh, ...]
    observed_at: str


class PamVolumeStore:
    def __init__(
        self, api_key: str, *, catalog_ttl_seconds: float = CATALOG_TTL_SECONDS
    ) -> None:
        self._api_key = api_key
        self._catalog_ttl_seconds = catalog_ttl_seconds
        self._cache: dict[int, _CachedVolume] = {}
        self._checked_at: dict[int, float] = {}
        self._locks: dict[int, threading.Lock] = {}
        self._registry_lock = threading.Lock()

    # ── I/O isolées pour l'injection en test ───────────────────────────
    def _fetch_catalog(self, url: str) -> dict:
        response = httpx.get(
            url, headers={"apikey": self._api_key, "Accept": "application/json"},
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()

    def _fetch_product(self, url: str) -> bytes:
        response = httpx.get(
            url,
            headers={"apikey": self._api_key, "Accept": "application/octet-stream"},
            timeout=60.0,
        )
        response.raise_for_status()
        raw = response.content
        return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw

    def _decode_zh(self, raw: bytes) -> PolarScanZh:
        return parse_zh_scan(select_zh_message(split_messages(raw)))

    # ── Volume par station/cycle ───────────────────────────────────────
    def _station_lock(self, station_id: int) -> threading.Lock:
        with self._registry_lock:
            return self._locks.setdefault(station_id, threading.Lock())

    def _volume(self, station_id: int) -> _CachedVolume:
        cached = self._cache.get(station_id)
        now = time.monotonic()
        last_checked = self._checked_at.get(station_id)
        if (
            cached is not None
            and last_checked is not None
            and now - last_checked < self._catalog_ttl_seconds
        ):
            return cached

        catalog = self._fetch_catalog(
            f"{BASE_URL}/stations/{station_id}/observations/PAM"
        )
        self._checked_at[station_id] = now
        links = [
            (str(link["href"]), str(link.get("validity_time", "")))
            for link in catalog.get("links", [])
            if "tour_antenne=" in str(link.get("href", ""))
        ][:MAX_TOURS]
        if not links:
            raise RadarMetadataError("PAM catalogue exposes no antenna tour")
        cycle_key = tuple(validity for _, validity in links)
        if cached is not None and cached.cycle_key == cycle_key:
            return cached
        scans = tuple(self._decode_zh(self._fetch_product(url)) for url, _ in links)
        volume = _CachedVolume(
            cycle_key=cycle_key, scans=scans, observed_at=max(cycle_key)
        )
        self._cache[station_id] = volume
        return volume

    def column(self, lat: float, lon: float) -> dict:
        located = nearest_station(lat, lon)
        if located is None:
            # Distance à la station la moins lointaine, pour le message d'erreur.
            best_id, best_m = min(
                (
                    (s.station_id,
                     great_circle_distance_m(lat, lon, s.latitude, s.longitude))
                    for s in STATIONS.values()
                ),
                key=lambda item: item[1],
            )
            raise OutOfRangeError(best_id, round(best_m / 1000.0, 1))
        station, distance_m = located
        with self._station_lock(station.station_id):
            volume = self._volume(station.station_id)
        levels = []
        for scan in volume.scans:
            sample = column_sample(scan, lat, lon)
            if sample is None:
                continue
            levels.append(
                {
                    "elevationDeg": round(sample.elevation_deg, 1),
                    "altitudeM": round(sample.altitude_m, 1),
                    "dbz": None if sample.dbz is None else round(sample.dbz, 1),
                }
            )
        levels.sort(key=lambda level: level["altitudeM"])
        return {
            "schemaVersion": 1,
            "source": SOURCE,
            "license": LICENSE,
            "station": {
                "id": station.station_id,
                "name": station.name,
                "lat": station.latitude,
                "lon": station.longitude,
            },
            "distanceKm": round(distance_m / 1000.0, 1),
            "observedAt": volume.observed_at,
            "levels": levels,
        }
