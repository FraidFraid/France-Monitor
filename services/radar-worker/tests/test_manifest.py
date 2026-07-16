import json
from pathlib import Path
import sys


WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from models import build_manifest
from radar_api import select_product_link
from app import Settings, create_app


FIXTURE_GRID = json.loads(
    (Path(__file__).parent / "fixtures" / "decoded_mosaic.json").read_text()
)


def test_manifest_contains_observation_and_bounds():
    manifest = build_manifest(
        FIXTURE_GRID,
        public_base_url="https://radar.example.test",
        generated_at="2026-07-16T12:57:00Z",
    )

    assert manifest["source"] == "Météo-France DPRadar"
    assert manifest["observedAt"] == "2026-07-16T12:50:00Z"
    assert manifest["imageUrl"].endswith("/rasters/radar-20260716T1250Z.webp")
    west, south, east, north = manifest["bounds"]
    assert west < east and south < north
    assert -180 <= west <= 180 and -90 <= south <= 90


def test_catalogue_selects_only_the_1000m_reflectivity_product():
    catalogue = {
        "links": [
            {
                "href": "https://public-api.meteofrance.fr/public/DPRadar/v1/mosaiques/METROPOLE/observations/REFLECTIVITE/produit?maille=1000",
                "validity_time": "2026-07-16T12:50:00Z",
            }
        ]
    }

    selected = select_product_link(catalogue)

    assert selected.observed_at == "2026-07-16T12:50:00Z"
    assert selected.url.endswith("produit?maille=1000")


def test_catalogue_accepts_the_official_link_shape_without_v1():
    selected = select_product_link(
        [
            {
                "href": "https://public-api.meteofrance.fr/public/DPRadar/mosaiques/METROPOLE/observations/REFLECTIVITE/produit?maille=1000",
                "validity_time": "2026-07-16T12:50:00Z",
            }
        ]
    )

    assert selected.url.startswith("https://public-api.meteofrance.fr/public/DPRadar/mosaiques/")


def test_health_reports_configuration_without_secrets(tmp_path):
    from fastapi.testclient import TestClient

    app = create_app(
        Settings(
            api_key="super-secret-api-key",
            worker_token="super-secret-worker-token",
            storage_dir=tmp_path,
            public_base_url="https://radar.example.test",
        )
    )

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["configured"] is True
    assert response.json()["storageReady"] is True
    assert not list(tmp_path.glob(".health-*.tmp"))
    assert "super-secret" not in response.text
