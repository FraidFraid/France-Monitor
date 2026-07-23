"""Cache volume PAM et endpoint /volume/column (API amont factice)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from pam_volume import OutOfRangeError, PamVolumeStore  # noqa: E402


def _fake_scan(elevation_deg: float):
    """Scan synthétique 720×200, écho uniforme code 40 partout."""
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
        gate_count=200,
        gate_length_m=240.0,
        codes=np.full((720, 200), 40, dtype=np.uint8),
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
