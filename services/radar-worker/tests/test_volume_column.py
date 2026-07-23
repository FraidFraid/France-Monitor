"""Cache volume PAM et endpoint /volume/column (API amont factice)."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from models import RadarMetadataError  # noqa: E402
from pam_volume import OutOfRangeError, PamVolumeStore, VolumeWarmingUp  # noqa: E402


def _fake_scan(elevation_deg: float, *, gate_count: int = 200, gate_length_m: float = 240.0):
    """Scan synthétique 720×gate_count, écho uniforme code 40 partout."""
    from pam_bitstream import PolarScanZh

    return PolarScanZh(
        observed_at_utc=(2026, 7, 23, 8, 30, 0),
        station_latitude=44.83139,
        station_longitude=-0.69194,
        antenna_altitude_m=50.0,
        elevation_deg=elevation_deg,
        azimuth_start_deg=0.0,
        azimuth_step_deg=0.5,
        azimuth_count=720,
        gate_count=gate_count,
        gate_length_m=gate_length_m,
        codes=np.full((720, gate_count), 40, dtype=np.uint8),
    )


@pytest.fixture()
def store(monkeypatch):
    catalog_calls = []

    def fake_fetch_json(self, url):
        catalog_calls.append(url)
        return {
            "links": [
                {"href": f"https://x/produit?tour_antenne={t}",
                 "validity_time": "2026-07-23T08:30:00Z"}
                for t in ("A", "B")
            ]
        }

    def fake_fetch_bytes(self, url):
        return b"tour-A" if "tour_antenne=A" in url else b"tour-B"

    def fake_decode(self, raw):
        return _fake_scan(8.0 if raw == b"tour-A" else 0.4)

    monkeypatch.setattr(PamVolumeStore, "_fetch_catalog", fake_fetch_json)
    monkeypatch.setattr(PamVolumeStore, "_fetch_product", fake_fetch_bytes)
    monkeypatch.setattr(PamVolumeStore, "_decode_zh", fake_decode)
    built = PamVolumeStore(api_key="k")
    built.test_catalog_calls = catalog_calls  # type: ignore[attr-defined]
    return built


def test_column_near_bordeaux_sorted_by_altitude(store):
    payload = store.column(44.9, -0.6)  # ~10.5 km de la station
    assert payload["station"] == {
        "id": 41, "name": "BORDEAUX", "lat": 44.83139, "lon": -0.69194,
    }
    assert payload["observedAt"] == "2026-07-23T08:30:00Z"
    altitudes = [level["altitudeM"] for level in payload["levels"]]
    assert altitudes == sorted(altitudes)
    assert len(payload["levels"]) == 2
    # Code ZH 40 -> dBZ = 40 * ZH_DBZ_GAIN + ZH_DBZ_OFFSET = 40*1.0 - 10.5 = 29.5
    # (calibration verrouillée par pam_bitstream.py / Task 3 ; le brief d'origine
    # avait été écrit avant que cette calibration ne soit figée et portait 9.5).
    assert all(level["dbz"] == pytest.approx(29.5) for level in payload["levels"])


def test_out_of_range_raises_with_nearest(store):
    with pytest.raises(OutOfRangeError) as excinfo:
        store.column(45.5, -5.5)
    # Catalogue réel (27 stations) : la plus proche de (45.5, -5.5) est
    # Plabennec (56), à ~339 km — le brief avait été écrit avant le
    # catalogue réel et devinait (41, 54).
    assert excinfo.value.nearest_station_id == 56
    assert excinfo.value.nearest_km == pytest.approx(339.1, abs=0.5)


def test_volume_downloaded_once_per_cycle(store):
    store.column(44.9, -0.6)
    first = len(store.test_catalog_calls)
    store.column(44.9, -0.7)
    assert len(store.test_catalog_calls) == first  # cache par cycle, pas de re-fetch


def test_endpoint_column_and_404(tmp_path):
    from app import Settings, create_app

    class FakeStore:
        def column(self, lat, lon):
            if lon < -3.0:
                raise OutOfRangeError(nearest_station_id=41, nearest_km=213.4)
            return {"schemaVersion": 1, "levels": []}

    # Pattern d'injection réellement en place dans create_app (voir
    # tests/test_worker.py) : les collaborateurs sont passés en paramètres à
    # create_app plutôt que via un attribut module-level ; le store factice
    # est injecté par volume_store_factory.
    application = create_app(
        Settings(
            api_key="k", worker_token="t",
            storage_dir=tmp_path,
            public_base_url="http://localhost:8091",
        ),
        volume_store_factory=lambda _api_key: FakeStore(),
    )
    client = TestClient(application)

    ok = client.get("/volume/column", params={"lat": 44.9, "lon": -0.6})
    assert ok.status_code == 200 and ok.json()["schemaVersion"] == 1

    missing = client.get("/volume/column", params={"lat": 45.5, "lon": -5.5})
    assert missing.status_code == 404
    assert missing.json()["detail"]["error"] == "hors_couverture"

    bad = client.get("/volume/column", params={"lat": "abc", "lon": -0.6})
    assert bad.status_code == 422


# ── Fix 1a : cache négatif borne le chemin d'échec ─────────────────────────

@pytest.fixture()
def failing_store(monkeypatch):
    """Store dont le catalogue échoue systématiquement (panne amont)."""
    catalog_calls = []

    def fake_fetch_catalog_fail(self, url):
        catalog_calls.append(url)
        raise RuntimeError("boom")

    monkeypatch.setattr(PamVolumeStore, "_fetch_catalog", fake_fetch_catalog_fail)
    built = PamVolumeStore(api_key="k")
    built.test_catalog_calls = catalog_calls  # type: ignore[attr-defined]
    return built


def test_negative_cache_blocks_immediate_retry(failing_store):
    with pytest.raises(RuntimeError):
        failing_store.column(44.9, -0.6)
    first = len(failing_store.test_catalog_calls)

    # Deuxième appel immédiat : erreur de cache négatif, AUCUN nouvel appel réseau.
    with pytest.raises(RadarMetadataError):
        failing_store.column(44.9, -0.6)
    assert len(failing_store.test_catalog_calls) == first


def test_negative_cache_expires_after_ttl(failing_store, monkeypatch):
    with pytest.raises(RuntimeError):
        failing_store.column(44.9, -0.6)
    first = len(failing_store.test_catalog_calls)

    # On avance l'horloge monotone au-delà du TTL (30 s) : le prochain appel
    # doit re-tenter le réseau plutôt que de rester sur le cache négatif.
    real_monotonic = time.monotonic
    monkeypatch.setattr(time, "monotonic", lambda: real_monotonic() + 31.0)

    with pytest.raises(RuntimeError):
        failing_store.column(44.9, -0.6)
    assert len(failing_store.test_catalog_calls) == first + 1


# ── Fix 1b : verrou non bloquant ────────────────────────────────────────────

def test_column_raises_warming_up_when_lock_held(store):
    lock = store._station_lock(41)  # BORDEAUX, station de la fixture `store`
    lock.acquire()
    try:
        with pytest.raises(VolumeWarmingUp):
            store.column(44.9, -0.6)
    finally:
        lock.release()


def test_endpoint_maps_warming_up_to_503(tmp_path):
    from app import Settings, create_app

    class FakeStore:
        def column(self, lat, lon):
            raise VolumeWarmingUp(41, "BORDEAUX")

    application = create_app(
        Settings(
            api_key="k", worker_token="t",
            storage_dir=tmp_path,
            public_base_url="http://localhost:8091",
        ),
        volume_store_factory=lambda _api_key: FakeStore(),
    )
    client = TestClient(application)

    warming = client.get("/volume/column", params={"lat": 44.9, "lon": -0.6})
    assert warming.status_code == 503
    assert warming.json()["detail"] == {
        "error": "volume_en_prechargement", "stationId": 41,
    }
    assert warming.headers["retry-after"] == "10"


# ── Fix 2 : niveaux > 30 km filtrés à la source ────────────────────────────

def test_column_drops_levels_above_max_altitude(monkeypatch):
    """Tour à forte élévation (45°) + porte lointaine -> altitude > 30 km.

    Le niveau correspondant doit être absent du profil, mais le profil doit
    quand même être renvoyé avec le niveau basse élévation.
    """
    high_elevation_scan = _fake_scan(45.0, gate_count=300, gate_length_m=1000.0)
    low_elevation_scan = _fake_scan(0.4, gate_count=300, gate_length_m=1000.0)

    def fake_fetch_catalog(self, url):
        return {
            "links": [
                {"href": "https://x/produit?tour_antenne=A",
                 "validity_time": "2026-07-23T08:30:00Z"},
                {"href": "https://x/produit?tour_antenne=B",
                 "validity_time": "2026-07-23T08:30:00Z"},
            ]
        }

    def fake_fetch_product(self, url):
        return b"tour-A" if "tour_antenne=A" in url else b"tour-B"

    def fake_decode(self, raw):
        return high_elevation_scan if raw == b"tour-A" else low_elevation_scan

    monkeypatch.setattr(PamVolumeStore, "_fetch_catalog", fake_fetch_catalog)
    monkeypatch.setattr(PamVolumeStore, "_fetch_product", fake_fetch_product)
    monkeypatch.setattr(PamVolumeStore, "_decode_zh", fake_decode)
    built = PamVolumeStore(api_key="k")

    # ~50 km au nord de la station BORDEAUX, encore la plus proche.
    target_lat = 44.83139 + 50_000 / 111_320
    target_lon = -0.69194

    payload = built.column(target_lat, target_lon)

    elevations = [level["elevationDeg"] for level in payload["levels"]]
    assert 45.0 not in elevations  # niveau haute élévation filtré (>30 km)
    assert 0.4 in elevations  # niveau basse élévation conservé
    assert all(level["altitudeM"] <= 30_000 for level in payload["levels"])
