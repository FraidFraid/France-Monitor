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
