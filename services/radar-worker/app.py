"""FastAPI entry point for the server-side Météo-France radar worker."""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import secrets
from typing import Any

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
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings or Settings.from_env()
    application = FastAPI(title="France Monitor radar worker")
    configured.storage_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = configured.storage_dir / "manifest.json"
    image_path = configured.storage_dir / "latest.webp"

    @application.get("/health")
    def health() -> dict[str, Any]:
        manifest = _read_manifest(manifest_path)
        return {
            "status": "ok",
            "configured": configured.configured,
            "storageReady": configured.storage_dir.is_dir(),
            "lastSuccessfulObservation": manifest.get("observedAt") if manifest else None,
        }

    @application.get("/manifest.json")
    def manifest() -> JSONResponse:
        value = _read_manifest(manifest_path)
        if value is None:
            raise HTTPException(status_code=404, detail="radar manifest is not available yet")
        return JSONResponse(value, headers={"Cache-Control": "no-cache"})

    @application.get("/latest.webp")
    def latest_image() -> FileResponse:
        if not image_path.is_file():
            raise HTTPException(status_code=404, detail="radar raster is not available yet")
        return FileResponse(image_path, media_type="image/webp", headers={"Cache-Control": "no-cache"})

    @application.post("/refresh")
    def refresh(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        expected = f"Bearer {configured.worker_token}"
        if not configured.worker_token or authorization is None or not secrets.compare_digest(
            authorization, expected
        ):
            raise HTTPException(status_code=401, detail="invalid worker token")
        if not configured.api_key:
            raise HTTPException(status_code=503, detail="radar API key is not configured")
        try:
            api = RadarApiClient(configured.api_key)
            product = api.discover_latest()
            raw_path = api.download(product, configured.storage_dir)
            grid = decode_bufr(raw_path, observed_at=product.observed_at)
            temporary_image = configured.storage_dir / ".latest.webp.tmp"
            render_reflectivity(
                grid["values"],
                width=grid["width"],
                height=grid["height"],
                output=temporary_image,
            )
            os.replace(temporary_image, image_path)
            public_manifest = build_manifest(
                grid,
                public_base_url=configured.public_base_url,
            )
            _write_json_atomic(manifest_path, public_manifest)
            return public_manifest
        except RadarMetadataError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail="radar refresh failed") from exc

    return application


app = create_app()
