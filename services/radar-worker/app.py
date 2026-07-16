"""FastAPI entry point for the server-side Météo-France radar worker."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
from typing import Any, Callable

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from bufr_decoder import decode_bufr
from models import RadarMetadataError, build_manifest
from radar_api import RadarApiClient
from render import render_reflectivity


@dataclass(frozen=True)
class Settings:
    api_key: str
    worker_token: str
    storage_dir: Path
    public_base_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            api_key=os.getenv("METEO_FRANCE_RADAR_API_KEY", ""),
            worker_token=os.getenv("RADAR_WORKER_TOKEN", ""),
            storage_dir=Path(os.getenv("RADAR_STORAGE_DIR", "./data/radar")),
            public_base_url=os.getenv("RADAR_PUBLIC_BASE_URL", "http://localhost:8091"),
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.worker_token and self.public_base_url)


def _read_manifest(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}-",
            suffix=".tmp",
            delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _storage_writable(path: Path) -> bool:
    probe: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path, prefix=".health-", suffix=".tmp", delete=False
        ) as stream:
            probe = Path(stream.name)
            stream.write(b"ok")
            stream.flush()
            os.fsync(stream.fileno())
        return True
    except OSError:
        return False
    finally:
        if probe is not None:
            probe.unlink(missing_ok=True)


def create_app(
    settings: Settings | None = None,
    *,
    api_factory: Callable[[str], Any] = RadarApiClient,
    decoder: Callable[..., dict[str, Any]] = decode_bufr,
    renderer: Callable[..., None] = render_reflectivity,
) -> FastAPI:
    configured = settings or Settings.from_env()
    application = FastAPI(title="France Monitor radar worker")
    configured.storage_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = configured.storage_dir / "manifest.json"
    raster_dir = configured.storage_dir / "rasters"
    raster_dir.mkdir(parents=True, exist_ok=True)
    refresh_lock = threading.Lock()

    @application.get("/health")
    def health() -> dict[str, Any]:
        manifest = _read_manifest(manifest_path)
        return {
            "status": "ok",
            "configured": configured.configured,
            "storageReady": _storage_writable(configured.storage_dir),
            "lastSuccessfulObservation": manifest.get("observedAt") if manifest else None,
        }

    @application.get("/manifest.json")
    def manifest() -> JSONResponse:
        value = _read_manifest(manifest_path)
        if value is None:
            raise HTTPException(status_code=404, detail="radar manifest is not available yet")
        return JSONResponse(value, headers={"Cache-Control": "no-cache"})

    @application.get("/rasters/{image_name}")
    def raster_image(image_name: str) -> FileResponse:
        if not image_name.startswith("radar-") or not image_name.endswith(".webp"):
            raise HTTPException(status_code=404, detail="radar raster is not available")
        image_path = raster_dir / image_name
        if not image_path.is_file():
            raise HTTPException(status_code=404, detail="radar raster is not available yet")
        return FileResponse(
            image_path,
            media_type="image/webp",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    @application.post("/refresh")
    def refresh(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        expected = f"Bearer {configured.worker_token}"
        if not configured.worker_token or authorization is None or not secrets.compare_digest(
            authorization, expected
        ):
            raise HTTPException(status_code=401, detail="invalid worker token")
        if not configured.api_key:
            raise HTTPException(status_code=503, detail="radar API key is not configured")
        with refresh_lock:
            temporary_image: Path | None = None
            published_image: Path | None = None
            created_image = False
            try:
                api = api_factory(configured.api_key)
                product = api.discover_latest()
                raw_path = api.download(product, configured.storage_dir)
                grid = decoder(raw_path, observed_at=product.observed_at)
                observed = datetime.fromisoformat(
                    str(grid["observedAt"]).replace("Z", "+00:00")
                )
                if observed.tzinfo is None:
                    raise RadarMetadataError("radar timestamps must include a timezone")
                version = observed.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
                image_name = f"radar-{version}.webp"
                published_image = raster_dir / image_name
                with tempfile.NamedTemporaryFile(
                    dir=raster_dir,
                    prefix=".render-",
                    suffix=".tmp",
                    delete=False,
                ) as stream:
                    temporary_image = Path(stream.name)
                renderer(
                    grid["values"],
                    width=grid["width"],
                    height=grid["height"],
                    output=temporary_image,
                )
                with temporary_image.open("rb") as stream:
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary_image, published_image)
                    created_image = True
                except FileExistsError:
                    pass
                public_manifest = build_manifest(
                    grid,
                    public_base_url=configured.public_base_url,
                    image_name=image_name,
                )
                _write_json_atomic(manifest_path, public_manifest)
                return public_manifest
            except RadarMetadataError as exc:
                if created_image and published_image is not None:
                    published_image.unlink(missing_ok=True)
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            except Exception as exc:
                if created_image and published_image is not None:
                    published_image.unlink(missing_ok=True)
                raise HTTPException(status_code=502, detail="radar refresh failed") from exc
            finally:
                if temporary_image is not None:
                    temporary_image.unlink(missing_ok=True)

    return application


app = create_app()
