from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import json
from pathlib import Path
import sys
import threading
import time

import pytest


WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

import radar_api
import app as radar_app
from app import Settings, create_app
from models import RadarMetadataError
from radar_api import LatestProduct, RadarApiClient


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        api_key="api-key",
        worker_token="worker-token",
        storage_dir=tmp_path,
        public_base_url="https://radar.example.test",
        # Boucle interne coupée : les tests d'endpoints pilotent leurs refreshes.
        refresh_interval_seconds=0,
    )


def _grid(observed_at: str = "2026-07-16T12:50:00Z") -> dict:
    return {
        "productId": "IMFR27_C_LFPW",
        "observedAt": observed_at,
        "width": 1536,
        "height": 1536,
        "resolutionMeters": 1000,
        "projection": {
            "type": "polar_stereographic",
            "geodeticDatum": "WGS84",
            "projectionCenter": "north_pole",
            "latitudeOfOrigin": 90,
            "latitudeOfTrueScale": 60,
            "centralMeridian": 0,
            "falseEasting": 0,
            "falseNorthing": 0,
        },
        "upperLeftProjected": [-768000, 768000],
        "values": [161],
    }


class _Api:
    def __init__(self, raw_path: Path, observed_at: str = "2026-07-16T12:50:00Z"):
        self.raw_path = raw_path
        self.product = LatestProduct("https://example.invalid/product", observed_at)

    def discover_latest(self):
        return self.product

    def download(self, product, storage_dir):
        return self.raw_path


def _renderer(values, *, width, height, output):
    output.write_bytes(b"RIFF-synthetic-webp")


def test_refresh_auth_rejects_absent_and_bad_token_and_accepts_good_token(tmp_path):
    from fastapi.testclient import TestClient

    raw = tmp_path / "source.bufr"
    raw.write_bytes(b"BUFR")
    app = create_app(
        _settings(tmp_path),
        api_factory=lambda _key: _Api(raw),
        decoder=lambda _path, observed_at: _grid(observed_at),
        renderer=_renderer,
    )
    client = TestClient(app)

    assert client.post("/refresh").status_code == 401
    assert client.post("/refresh", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert (
        client.post(
            "/refresh", headers={"Authorization": "Bearer worker-token"}
        ).status_code
        == 200
    )


def test_raster_response_allows_cross_origin_map_loading(tmp_path):
    from fastapi.testclient import TestClient

    raster = tmp_path / "rasters" / "radar-test.webp"
    raster.parent.mkdir(parents=True)
    raster.write_bytes(b"RIFF-synthetic-webp")

    response = TestClient(create_app(_settings(tmp_path))).get("/rasters/radar-test.webp")

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"


def test_discovery_accepts_exactly_20_hours_and_rejects_older(monkeypatch):
    now = datetime(2026, 7, 16, 20, tzinfo=timezone.utc)
    client = RadarApiClient("key")
    documents = iter(
        [
            {"links": [{"href": f"{radar_api.BASE_URL}/mosaiques/METROPOLE"}]},
            {
                "links": [
                    {
                        "href": f"{radar_api.BASE_URL}/mosaiques/METROPOLE/observations/REFLECTIVITE"
                    }
                ]
            },
            {
                "links": [
                    {
                        "href": f"{radar_api.BASE_URL}/mosaiques/METROPOLE/observations/REFLECTIVITE/produit?maille=1000",
                        "validity_time": (now - timedelta(hours=20)).isoformat(),
                    }
                ]
            },
        ]
    )
    monkeypatch.setattr(client, "_get_json", lambda _path: next(documents))

    assert client.discover_latest(now=now).observed_at.endswith("+00:00")

    documents = iter(
        [
            {"links": [{"href": f"{radar_api.BASE_URL}/mosaiques/METROPOLE"}]},
            {
                "links": [
                    {
                        "href": f"{radar_api.BASE_URL}/mosaiques/METROPOLE/observations/REFLECTIVITE"
                    }
                ]
            },
            {
                "links": [
                    {
                        "href": f"{radar_api.BASE_URL}/mosaiques/METROPOLE/observations/REFLECTIVITE/produit?maille=1000",
                        "validity_time": (now - timedelta(hours=20, seconds=1)).isoformat(),
                    }
                ]
            },
        ]
    )
    monkeypatch.setattr(client, "_get_json", lambda _path: next(documents))
    with pytest.raises(RadarMetadataError, match="20-hour"):
        client.discover_latest(now=now)


class _StreamResponse:
    def __init__(self, chunks):
        self._chunks = chunks

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def raise_for_status(self):
        return None

    def iter_bytes(self):
        yield from self._chunks


class _JsonResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"links": []}


def test_dpradar_requests_use_apikey_without_authorization(tmp_path, monkeypatch):
    request_headers = []

    def fake_get(*_args, **kwargs):
        request_headers.append(kwargs["headers"])
        return _JsonResponse()

    def fake_stream(*_args, **kwargs):
        request_headers.append(kwargs["headers"])
        return _StreamResponse([b"BUFRpayload"])

    monkeypatch.setattr(radar_api.httpx, "get", fake_get)
    monkeypatch.setattr(radar_api.httpx, "stream", fake_stream)
    client = RadarApiClient("dpradar-key")

    client._get_json("/mosaiques")
    downloaded = client.download(
        LatestProduct("https://example.invalid", "2026-07-16T12:50:00Z"), tmp_path
    )

    assert request_headers == [
        {"apikey": "dpradar-key", "Accept": "application/json"},
        {"apikey": "dpradar-key", "Accept": "application/octet-stream"},
    ]
    assert all("Authorization" not in headers for headers in request_headers)
    downloaded.unlink()


def test_download_streams_and_stops_at_compressed_limit(tmp_path, monkeypatch):
    yielded = 0

    def chunks():
        nonlocal yielded
        yielded += 1
        yield b"x" * 5
        yielded += 1
        yield b"y" * 5
        yielded += 1
        yield b"must-not-be-read"

    monkeypatch.setattr(radar_api, "MAX_COMPRESSED_BYTES", 8)
    monkeypatch.setattr(radar_api.httpx, "stream", lambda *_a, **_k: _StreamResponse(chunks()))

    with pytest.raises(RadarMetadataError, match="compressed"):
        RadarApiClient("key").download(
            LatestProduct("https://example.invalid", "2026-07-16T12:50:00Z"), tmp_path
        )
    assert yielded == 2


def test_download_rejects_corrupt_gzip_and_cleans_temporaries(tmp_path, monkeypatch):
    monkeypatch.setattr(
        radar_api.httpx,
        "stream",
        lambda *_a, **_k: _StreamResponse([b"\x1f\x8bnot-a-gzip"]),
    )

    with pytest.raises(RadarMetadataError, match="gzip"):
        RadarApiClient("key").download(
            LatestProduct("https://example.invalid", "2026-07-16T12:50:00Z"), tmp_path
        )
    assert not list(tmp_path.rglob("*.tmp"))


def test_download_enforces_decompressed_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(radar_api, "MAX_DECOMPRESSED_BYTES", 8)
    monkeypatch.setattr(
        radar_api.httpx,
        "stream",
        lambda *_a, **_k: _StreamResponse([gzip.compress(b"BUFR" + b"x" * 32)]),
    )

    with pytest.raises(RadarMetadataError, match="decompressed"):
        RadarApiClient("key").download(
            LatestProduct("https://example.invalid", "2026-07-16T12:50:00Z"), tmp_path
        )


def test_download_checks_bufr_signature_without_reading_whole_file(tmp_path, monkeypatch):
    monkeypatch.setattr(
        radar_api.httpx,
        "stream",
        lambda *_a, **_k: _StreamResponse([b"IMFR27 LFPW 161250\r\r\nBUFRpayload"]),
    )
    monkeypatch.setattr(
        Path,
        "read_bytes",
        lambda _path: (_ for _ in ()).throw(AssertionError("unbounded read")),
    )

    result = RadarApiClient("key").download(
        LatestProduct("https://example.invalid", "2026-07-16T12:50:00Z"), tmp_path
    )

    assert result.name.startswith(".candidate-")
    assert result.suffix == ".tmp"
    result.unlink()


def test_refreshes_are_serialized_and_publish_matching_manifest_image(tmp_path):
    from fastapi.testclient import TestClient

    raw = tmp_path / "source.bufr"
    raw.write_bytes(b"BUFR")
    active = 0
    maximum_active = 0
    guard = threading.Lock()

    def decoder(_path, observed_at):
        nonlocal active, maximum_active
        with guard:
            active += 1
            maximum_active = max(maximum_active, active)
        time.sleep(0.05)
        with guard:
            active -= 1
        return _grid(observed_at)

    app = create_app(
        _settings(tmp_path),
        api_factory=lambda _key: _Api(raw),
        decoder=decoder,
        renderer=_renderer,
    )

    def refresh():
        with TestClient(app) as client:
            return client.post(
                "/refresh", headers={"Authorization": "Bearer worker-token"}
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _n: refresh(), range(2)))

    assert [response.status_code for response in responses] == [200, 200]
    assert maximum_active == 1
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    image_name = manifest["imageUrl"].rsplit("/", 1)[-1]
    assert (tmp_path / "rasters" / image_name).read_bytes() == b"RIFF-synthetic-webp"


def test_refresh_failure_keeps_previous_manifest_and_raster(tmp_path):
    from fastapi.testclient import TestClient

    raster_dir = tmp_path / "rasters"
    raster_dir.mkdir()
    old_image = raster_dir / "radar-20260716T1200Z.webp"
    old_image.write_bytes(b"old-image")
    old_manifest = {"observedAt": "2026-07-16T12:00:00Z", "imageUrl": f"https://radar.example.test/{old_image.name}"}
    (tmp_path / "manifest.json").write_text(json.dumps(old_manifest))
    raw = tmp_path / "source.bufr"
    raw.write_bytes(b"BUFR")

    def failing_renderer(*_args, **_kwargs):
        raise RuntimeError("render failed")

    app = create_app(
        _settings(tmp_path),
        api_factory=lambda _key: _Api(raw),
        decoder=lambda _path, observed_at: _grid(observed_at),
        renderer=failing_renderer,
    )
    response = TestClient(app).post(
        "/refresh", headers={"Authorization": "Bearer worker-token"}
    )

    assert response.status_code == 502
    assert json.loads((tmp_path / "manifest.json").read_text()) == old_manifest
    assert old_image.read_bytes() == b"old-image"
    assert not list(tmp_path.rglob("*.tmp"))


def test_invalid_payload_is_not_archived_and_same_timestamp_retry_can_succeed(
    tmp_path, monkeypatch
):
    from fastapi.testclient import TestClient

    payloads = iter(
        [
            b"IMFR27 LFPW 161250\r\r\nBUFR-invalid",
            b"IMFR27 LFPW 161250\r\r\nBUFR-valid",
        ]
    )
    monkeypatch.setattr(
        radar_api.httpx,
        "stream",
        lambda *_a, **_k: _StreamResponse([next(payloads)]),
    )
    client = RadarApiClient("key")
    product = LatestProduct("https://example.invalid", "2026-07-16T12:50:00Z")

    class RetryApi:
        def discover_latest(self):
            return product

        def download(self, selected, storage_dir):
            return client.download(selected, storage_dir)

    def decoder(path, observed_at):
        if b"invalid" in path.read_bytes():
            raise RadarMetadataError("invalid synthetic payload")
        return _grid(observed_at)

    application = create_app(
        _settings(tmp_path),
        api_factory=lambda _key: RetryApi(),
        decoder=decoder,
        renderer=_renderer,
    )
    http = TestClient(application)
    headers = {"Authorization": "Bearer worker-token"}

    assert http.post("/refresh", headers=headers).status_code == 502
    assert not list((tmp_path / "raw").glob("radar-*.bufr"))
    assert http.post("/refresh", headers=headers).status_code == 200
    archives = list((tmp_path / "raw").glob("radar-*.bufr"))
    assert len(archives) == 1
    assert b"valid" in archives[0].read_bytes()
    assert not list((tmp_path / "raw").glob(".*.tmp"))


def test_pruning_bounds_raw_archives_to_newest_files(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    archives = []
    for index in range(4):
        archive = raw_dir / f"radar-20260716T12{index}0Z-{index:012x}.bufr"
        archive.write_bytes(str(index).encode())
        archive.touch()
        archives.append(archive)
        time.sleep(0.01)

    radar_app._prune_files(raw_dir, "radar-*.bufr", keep=2)

    assert {path.name for path in raw_dir.glob("*.bufr")} == {
        archives[2].name,
        archives[3].name,
    }


def test_pruning_never_deletes_raster_referenced_by_current_manifest(tmp_path):
    raster_dir = tmp_path / "rasters"
    raster_dir.mkdir()
    current = raster_dir / "radar-20260716T1200Z.webp"
    current.write_bytes(b"current")
    newer = []
    for minute in (10, 20, 30):
        path = raster_dir / f"radar-20260716T12{minute}Z.webp"
        path.write_bytes(str(minute).encode())
        path.touch()
        newer.append(path)
        time.sleep(0.01)

    radar_app._prune_files(
        raster_dir,
        "radar-*.webp",
        keep=2,
        protected={current.resolve()},
    )

    assert {path.name for path in raster_dir.glob("*.webp")} == {
        current.name,
        newer[-1].name,
    }


def test_manifest_write_failure_rolls_back_raster_without_pruning_rasters(tmp_path):
    from fastapi.testclient import TestClient

    raster_dir = tmp_path / "rasters"
    raster_dir.mkdir()
    old_files = []
    for minute in (0, 10, 20):
        path = raster_dir / f"radar-20260716T12{minute:02d}Z.webp"
        path.write_bytes(b"old")
        old_files.append(path)
    old_manifest = {
        "observedAt": "2026-07-16T12:00:00Z",
        "imageUrl": f"https://radar.example.test/rasters/{old_files[0].name}",
    }
    (tmp_path / "manifest.json").write_text(json.dumps(old_manifest))
    candidate = tmp_path / "candidate.bufr"
    candidate.write_bytes(b"BUFR")

    def fail_manifest(_path, _value):
        raise OSError("manifest swap failed")

    settings = Settings(
        api_key="api-key",
        worker_token="worker-token",
        storage_dir=tmp_path,
        public_base_url="https://radar.example.test",
        raw_retention=1,
        raster_retention=1,
    )
    application = create_app(
        settings,
        api_factory=lambda _key: _Api(candidate, "2026-07-16T12:50:00Z"),
        decoder=lambda _path, observed_at: _grid(observed_at),
        renderer=_renderer,
        manifest_writer=fail_manifest,
    )

    response = TestClient(application).post(
        "/refresh", headers={"Authorization": "Bearer worker-token"}
    )

    assert response.status_code == 502
    assert json.loads((tmp_path / "manifest.json").read_text()) == old_manifest
    assert {path.name for path in raster_dir.glob("*.webp")} == {
        path.name for path in old_files
    }


# ─── POST /publish (production déportée : décodage sur runner externe) ────────

import base64


def _webp_bytes(payload: bytes = b"radar-pixels") -> bytes:
    body = b"WEBP" + payload
    return b"RIFF" + len(body).to_bytes(4, "little") + body


def _publish_payload(
    observed_at: str = "2026-07-16T12:50:00Z",
    image: bytes | None = None,
    **overrides,
) -> dict:
    manifest = {
        "schemaVersion": 1,
        "source": "Météo-France DPRadar",
        "observedAt": observed_at,
        "generatedAt": "2026-07-16T12:52:00Z",
        "bounds": [-9.965, 39.46785, 14.564708, 53.67],
        "resolutionMeters": 1000,
        "license": "Licence Ouverte 2.0",
    }
    manifest.update(overrides)
    image_bytes = image if image is not None else _webp_bytes()
    return {
        "manifest": manifest,
        "imageBase64": base64.b64encode(image_bytes).decode("ascii"),
    }


def _auth() -> dict:
    return {"Authorization": "Bearer worker-token"}


def test_publish_requires_bearer_token(tmp_path):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(_settings(tmp_path)))
    assert client.post("/publish", json=_publish_payload()).status_code == 401
    assert client.post(
        "/publish", json=_publish_payload(), headers={"Authorization": "Bearer wrong"}
    ).status_code == 401


def test_publish_stores_manifest_and_serves_raster(tmp_path):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(_settings(tmp_path)))
    response = client.post("/publish", json=_publish_payload(), headers=_auth())

    assert response.status_code == 200
    manifest = response.json()
    assert manifest["observedAt"] == "2026-07-16T12:50:00Z"
    assert manifest["imageUrl"].startswith(
        "https://radar.example.test/rasters/radar-20260716T1250Z-"
    )
    assert manifest["imageUrl"].endswith(".webp")

    assert client.get("/manifest.json").json() == manifest
    image_name = manifest["imageUrl"].rsplit("/", 1)[-1]
    raster = client.get(f"/rasters/{image_name}")
    assert raster.status_code == 200
    assert raster.content == _webp_bytes()
    health = client.get("/health").json()
    assert health["lastSuccessfulObservation"] == "2026-07-16T12:50:00Z"


def test_publish_rejects_non_webp_image(tmp_path):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(_settings(tmp_path)))
    payload = _publish_payload(image=b"GIF89a-not-a-webp-raster")
    response = client.post("/publish", json=payload, headers=_auth())

    assert response.status_code == 400
    assert not (tmp_path / "manifest.json").exists()


def test_publish_rejects_invalid_manifest_fields(tmp_path):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(_settings(tmp_path)))
    for bad in (
        {"source": "autre"},
        {"license": "WTFPL"},
        {"schemaVersion": 2},
        {"bounds": [14.5, 39.4, -9.9, 53.6]},
        {"bounds": [-9.9, 39.4, 14.5]},
        {"observedAt": "pas-une-date"},
    ):
        response = client.post(
            "/publish", json=_publish_payload(**bad), headers=_auth()
        )
        assert response.status_code == 400, bad
    assert not (tmp_path / "manifest.json").exists()


def test_publish_rejects_stale_observation_and_replays_idempotently(tmp_path):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(_settings(tmp_path)))
    fresh = client.post(
        "/publish", json=_publish_payload("2026-07-16T12:50:00Z"), headers=_auth()
    )
    assert fresh.status_code == 200

    stale = client.post(
        "/publish", json=_publish_payload("2026-07-16T12:45:00Z"), headers=_auth()
    )
    assert stale.status_code == 409
    assert client.get("/manifest.json").json() == fresh.json()

    replay = client.post(
        "/publish", json=_publish_payload("2026-07-16T12:50:00Z"), headers=_auth()
    )
    assert replay.status_code == 200
    assert replay.json() == fresh.json()


def test_publish_rejects_oversized_image(tmp_path):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(_settings(tmp_path)))
    huge = _webp_bytes(b"x" * (8 * 1024 * 1024))
    response = client.post(
        "/publish", json=_publish_payload(image=huge), headers=_auth()
    )

    assert response.status_code == 413
    assert not (tmp_path / "manifest.json").exists()


def test_publish_prunes_old_rasters_but_keeps_current(tmp_path):
    from fastapi.testclient import TestClient

    settings = Settings(
        api_key="api-key",
        worker_token="worker-token",
        storage_dir=tmp_path,
        public_base_url="https://radar.example.test",
        raster_retention=1,
    )
    client = TestClient(create_app(settings))
    first = client.post(
        "/publish",
        json=_publish_payload("2026-07-16T12:45:00Z", image=_webp_bytes(b"a")),
        headers=_auth(),
    )
    assert first.status_code == 200
    second = client.post(
        "/publish",
        json=_publish_payload("2026-07-16T12:50:00Z", image=_webp_bytes(b"b")),
        headers=_auth(),
    )
    assert second.status_code == 200

    current_name = second.json()["imageUrl"].rsplit("/", 1)[-1]
    names = {path.name for path in (tmp_path / "rasters").glob("*.webp")}
    assert names == {current_name}


# ─── Boucle de rafraîchissement interne ──────────────────────────────────────


def test_scheduler_refreshes_without_http_trigger(tmp_path):
    from fastapi.testclient import TestClient

    raw = tmp_path / "source.bufr"
    raw.write_bytes(b"BUFR")
    settings = Settings(
        api_key="api-key",
        worker_token="worker-token",
        storage_dir=tmp_path,
        public_base_url="https://radar.example.test",
        refresh_interval_seconds=1,
    )
    application = create_app(
        settings,
        api_factory=lambda _key: _Api(raw),
        decoder=lambda _path, observed_at: _grid(observed_at),
        renderer=_renderer,
    )

    with TestClient(application):
        deadline = time.time() + 5.0
        while time.time() < deadline and not (tmp_path / "manifest.json").exists():
            time.sleep(0.05)
        assert (tmp_path / "manifest.json").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["observedAt"] == "2026-07-16T12:50:00Z"


def test_scheduler_disabled_when_interval_is_zero(tmp_path):
    from fastapi.testclient import TestClient

    raw = tmp_path / "source.bufr"
    raw.write_bytes(b"BUFR")
    settings = Settings(
        api_key="api-key",
        worker_token="worker-token",
        storage_dir=tmp_path,
        public_base_url="https://radar.example.test",
        refresh_interval_seconds=0,
    )
    application = create_app(
        settings,
        api_factory=lambda _key: _Api(raw),
        decoder=lambda _path, observed_at: _grid(observed_at),
        renderer=_renderer,
    )

    with TestClient(application):
        time.sleep(0.3)
    assert not (tmp_path / "manifest.json").exists()


# ─── Raster sommets d'écho (aide pyroconvection) ─────────────────────────────


def test_refresh_publishes_echo_top_raster(tmp_path):
    from fastapi.testclient import TestClient

    raw = tmp_path / "source.bufr"
    raw.write_bytes(b"BUFR")

    def decoder(_path, observed_at):
        return {**_grid(observed_at), "echoTops": [None, 1500.0]}

    def echo_renderer(values, *, width, height, output):
        output.write_bytes(b"RIFF-echo-tops")

    app = create_app(
        _settings(tmp_path),
        api_factory=lambda _key: _Api(raw),
        decoder=decoder,
        renderer=_renderer,
        echo_renderer=echo_renderer,
    )
    client = TestClient(app)

    response = client.post("/refresh", headers=_auth())

    assert response.status_code == 200
    manifest = response.json()
    assert "radar-echotops-20260716T1250Z-" in manifest["echoTopImageUrl"]
    name = manifest["echoTopImageUrl"].rsplit("/", 1)[-1]
    raster = client.get(f"/rasters/{name}")
    assert raster.status_code == 200
    assert raster.content == b"RIFF-echo-tops"


def test_refresh_omits_echo_top_field_without_heights(tmp_path):
    from fastapi.testclient import TestClient

    raw = tmp_path / "source.bufr"
    raw.write_bytes(b"BUFR")
    app = create_app(
        _settings(tmp_path),
        api_factory=lambda _key: _Api(raw),
        decoder=lambda _path, observed_at: _grid(observed_at),
        renderer=_renderer,
    )

    response = TestClient(app).post("/refresh", headers=_auth())

    assert response.status_code == 200
    assert "echoTopImageUrl" not in response.json()


class _StatusResponse:
    """Réponse JSON dont raise_for_status simule une erreur amont."""

    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"links": []}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise radar_api.httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=radar_api.httpx.Request("GET", "https://example.invalid"),
                response=radar_api.httpx.Response(self.status_code),
            )

    def json(self):
        return self._payload


def test_discovery_retries_transient_upstream_status(monkeypatch):
    # DPRadar renvoie sporadiquement 429/5xx : la découverte doit réessayer
    # au lieu de faire échouer tout le rafraîchissement.
    statuses = iter([429, 503, 200])
    attempts = []

    def fake_get(*_args, **_kwargs):
        status = next(statuses)
        attempts.append(status)
        return _StatusResponse(status)

    monkeypatch.setattr(radar_api.httpx, "get", fake_get)
    monkeypatch.setattr(radar_api.time, "sleep", lambda _seconds: None)

    assert RadarApiClient("key")._get_json("/mosaiques") == {"links": []}
    assert attempts == [429, 503, 200]


def test_discovery_gives_up_after_retry_budget(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _StatusResponse(502)

    monkeypatch.setattr(radar_api.httpx, "get", fake_get)
    monkeypatch.setattr(radar_api.time, "sleep", lambda _seconds: None)

    with pytest.raises(RadarMetadataError, match="502"):
        RadarApiClient("key")._get_json("/mosaiques")


def test_discovery_does_not_retry_client_errors(monkeypatch):
    # 401/403 = clé invalide : réessayer ne sert à rien et brûle le quota.
    attempts = []

    def fake_get(*_args, **_kwargs):
        attempts.append(401)
        return _StatusResponse(401)

    monkeypatch.setattr(radar_api.httpx, "get", fake_get)
    monkeypatch.setattr(radar_api.time, "sleep", lambda _seconds: None)

    with pytest.raises(RadarMetadataError, match="401"):
        RadarApiClient("key")._get_json("/mosaiques")
    assert attempts == [401]


def test_refresh_failure_detail_names_the_cause(tmp_path, capsys):
    from fastapi.testclient import TestClient

    raw = tmp_path / "source.bufr"
    raw.write_bytes(b"BUFR")

    def failing_renderer(*_args, **_kwargs):
        raise RuntimeError("boom secret-free")

    app = create_app(
        _settings(tmp_path),
        api_factory=lambda _key: _Api(raw),
        decoder=lambda _path, observed_at: _grid(observed_at),
        renderer=failing_renderer,
    )

    response = TestClient(app, raise_server_exceptions=False).post(
        "/refresh", headers=_auth()
    )

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert "RuntimeError" in detail
    assert "boom secret-free" in detail
    # La trace complète part sur stdout pour être lisible dans les logs Railway.
    assert "Traceback" in capsys.readouterr().out
