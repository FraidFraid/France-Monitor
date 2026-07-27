"""FastAPI entry point for the server-side Météo-France radar worker."""

from __future__ import annotations

import asyncio
import base64
import contextlib
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import traceback
from typing import Any, Callable, Mapping
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from bufr_decoder import decode_bufr
from models import LICENSE, RadarMetadataError, SOURCE, build_manifest
from pam_volume import OutOfRangeError, PamVolumeStore, VolumeWarmingUp
from radar_api import RadarApiClient, archive_validated_product
from render import render_echo_tops, render_reflectivity


MAX_PUBLISH_IMAGE_BYTES = 8 * 1024 * 1024
PUBLISH_MANIFEST_KEYS = {
    "schemaVersion",
    "source",
    "observedAt",
    "generatedAt",
    "bounds",
    "resolutionMeters",
    "license",
}


class PublishRequest(BaseModel):
    manifest: dict[str, Any]
    imageBase64: str


def _parse_utc_instant(value: Any) -> datetime:
    """Parse le format strict émis par build_manifest, sans tolérance."""
    if not isinstance(value, str):
        raise RadarMetadataError("manifest timestamps must be strings")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise RadarMetadataError(f"invalid manifest timestamp: {value}") from exc
    return parsed.replace(tzinfo=timezone.utc)


def validated_publish_manifest(manifest: Mapping[str, Any]) -> dict[str, Any]:
    """Valide strictement un manifeste produit hors du worker (sans imageUrl)."""

    if set(manifest.keys()) != PUBLISH_MANIFEST_KEYS:
        raise RadarMetadataError("manifest must carry exactly the published fields")
    if manifest["schemaVersion"] != 1:
        raise RadarMetadataError("unsupported manifest schemaVersion")
    if manifest["source"] != SOURCE:
        raise RadarMetadataError("unexpected manifest source")
    if manifest["license"] != LICENSE:
        raise RadarMetadataError("unexpected manifest license")
    resolution = manifest["resolutionMeters"]
    if isinstance(resolution, bool) or not isinstance(resolution, int) or resolution <= 0:
        raise RadarMetadataError("resolutionMeters must be a positive integer")
    observed = _parse_utc_instant(manifest["observedAt"])
    generated = _parse_utc_instant(manifest["generatedAt"])
    if generated < observed:
        raise RadarMetadataError("generatedAt cannot precede observedAt")
    bounds = manifest["bounds"]
    if not isinstance(bounds, list) or len(bounds) != 4:
        raise RadarMetadataError("bounds must be [west, south, east, north]")
    coerced: list[float] = []
    for value in bounds:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise RadarMetadataError("bounds must contain finite numbers")
        coerced.append(float(value))
    west, south, east, north = coerced
    if not (-180.0 <= west < east <= 180.0 and -90.0 <= south < north <= 90.0):
        raise RadarMetadataError("bounds are not a valid WGS84 rectangle")
    return {
        "schemaVersion": 1,
        "source": SOURCE,
        "observedAt": manifest["observedAt"],
        "generatedAt": manifest["generatedAt"],
        "bounds": coerced,
        "resolutionMeters": resolution,
        "license": LICENSE,
    }


@dataclass(frozen=True)
class Settings:
    api_key: str
    worker_token: str
    storage_dir: Path
    public_base_url: str
    raw_retention: int = 24
    raster_retention: int = 24
    # Boucle interne de rafraîchissement ; 0 = désactivée (déclencheur externe).
    refresh_interval_seconds: int = 300

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            api_key=os.getenv("METEO_FRANCE_RADAR_API_KEY", ""),
            worker_token=os.getenv("RADAR_WORKER_TOKEN", ""),
            storage_dir=Path(os.getenv("RADAR_STORAGE_DIR", "./data/radar")),
            public_base_url=os.getenv("RADAR_PUBLIC_BASE_URL", "http://localhost:8091"),
            raw_retention=_positive_env("RADAR_RAW_RETENTION", 24),
            raster_retention=_positive_env("RADAR_RASTER_RETENTION", 24),
            refresh_interval_seconds=_non_negative_env(
                "RADAR_REFRESH_INTERVAL_SECONDS", 300
            ),
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.worker_token and self.public_base_url)


def _positive_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive integer") from exc
    if value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _non_negative_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a non-negative integer") from exc
    if value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return value


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


def _prune_files(
    directory: Path,
    pattern: str,
    *,
    keep: int,
    protected: set[Path] | None = None,
) -> None:
    if keep < 1:
        raise ValueError("retention must keep at least one file")
    protected_paths = {path.resolve() for path in (protected or set())}
    files = sorted(
        (path for path in directory.glob(pattern) if path.is_file()),
        key=lambda path: (path.stat().st_mtime_ns, path.name),
        reverse=True,
    )
    retained = {path for path in files if path.resolve() in protected_paths}
    for path in files:
        if len(retained) >= keep:
            break
        retained.add(path)
    for path in files:
        if path not in retained:
            path.unlink(missing_ok=True)


def _is_download_candidate(path: Path, storage_dir: Path) -> bool:
    raw_dir = (storage_dir.resolve() / "raw").resolve()
    return path.parent.resolve() == raw_dir and path.name.startswith(".candidate-")


def create_app(
    settings: Settings | None = None,
    *,
    api_factory: Callable[[str], Any] = RadarApiClient,
    decoder: Callable[..., dict[str, Any]] = decode_bufr,
    renderer: Callable[..., None] = render_reflectivity,
    echo_renderer: Callable[..., None] = render_echo_tops,
    archiver: Callable[..., Path] = archive_validated_product,
    manifest_writer: Callable[[Path, dict[str, Any]], None] = _write_json_atomic,
    volume_store_factory: Callable[[str], Any] = PamVolumeStore,
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
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Access-Control-Allow-Origin": "*",
            },
        )

    volume_store = volume_store_factory(configured.api_key)

    @application.get("/volume/column")
    def volume_column(lat: float, lon: float) -> JSONResponse:
        if not configured.api_key:
            raise HTTPException(status_code=503, detail="radar API key is not configured")
        if not (41.0 <= lat <= 52.0 and -6.0 <= lon <= 10.0):
            raise HTTPException(status_code=422, detail="lat/lon outside métropole bounds")
        try:
            payload = volume_store.column(lat, lon)
        except OutOfRangeError as exc:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "hors_couverture",
                    "nearestStationId": exc.nearest_station_id,
                    "nearestStationKm": exc.nearest_km,
                },
            ) from exc
        except VolumeWarmingUp as exc:
            # Verrou station déjà pris par une autre requête : on ne fait pas
            # attendre l'appelant sur le threadpool, on le renvoie tout de
            # suite avec une consigne de nouvelle tentative.
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "volume_en_prechargement",
                    "stationId": exc.station_id,
                },
                headers={"Retry-After": "10"},
            ) from exc
        except RadarMetadataError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — httpx et décodage confondus
            raise HTTPException(status_code=502, detail="radar volume unavailable") from exc
        return JSONResponse(
            payload, headers={"Cache-Control": "public, max-age=120",
                              "Access-Control-Allow-Origin": "*"}
        )

    def _perform_refresh() -> dict[str, Any]:
        with refresh_lock:
            temporary_image: Path | None = None
            published_image: Path | None = None
            temporary_echo: Path | None = None
            published_echo: Path | None = None
            raw_candidate: Path | None = None
            created_image = False
            created_echo = False
            try:
                api = api_factory(configured.api_key)
                product = api.discover_latest()
                raw_candidate = api.download(product, configured.storage_dir)
                grid = decoder(raw_candidate, observed_at=product.observed_at)
                archived_raw = archiver(raw_candidate, product, configured.storage_dir)
                try:
                    _prune_files(
                        configured.storage_dir / "raw",
                        "radar-*.bufr",
                        keep=configured.raw_retention,
                    )
                except OSError:
                    pass
                observed = datetime.fromisoformat(
                    str(grid["observedAt"]).replace("Z", "+00:00")
                )
                if observed.tzinfo is None:
                    raise RadarMetadataError("radar timestamps must include a timezone")
                version = observed.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
                content_hash = archived_raw.stem.rsplit("-", 1)[-1]
                image_name = f"radar-{version}-{content_hash}.webp"
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

                # Sommets d'écho (010002) : second raster, même grille.
                echo_tops = grid.get("echoTops")
                echo_image_name: str | None = None
                if echo_tops is not None:
                    echo_image_name = f"radar-echotops-{version}-{content_hash}.webp"
                    published_echo = raster_dir / echo_image_name
                    with tempfile.NamedTemporaryFile(
                        dir=raster_dir,
                        prefix=".render-echo-",
                        suffix=".tmp",
                        delete=False,
                    ) as stream:
                        temporary_echo = Path(stream.name)
                    echo_renderer(
                        echo_tops,
                        width=grid["width"],
                        height=grid["height"],
                        output=temporary_echo,
                    )
                    with temporary_echo.open("rb") as stream:
                        os.fsync(stream.fileno())
                    try:
                        os.link(temporary_echo, published_echo)
                        created_echo = True
                    except FileExistsError:
                        pass

                public_manifest = build_manifest(
                    grid,
                    public_base_url=configured.public_base_url,
                    image_name=image_name,
                    echo_top_image_name=echo_image_name,
                )
                manifest_writer(manifest_path, public_manifest)
                current_raster = raster_dir / Path(
                    urlparse(public_manifest["imageUrl"]).path
                ).name
                protected = {current_raster.resolve()}
                if published_echo is not None:
                    protected.add(published_echo.resolve())
                try:
                    _prune_files(
                        raster_dir,
                        "radar-*.webp",
                        keep=configured.raster_retention,
                        protected=protected,
                    )
                except OSError:
                    pass
                return public_manifest
            except Exception:
                if created_image and published_image is not None:
                    published_image.unlink(missing_ok=True)
                if created_echo and published_echo is not None:
                    published_echo.unlink(missing_ok=True)
                raise
            finally:
                if temporary_image is not None:
                    temporary_image.unlink(missing_ok=True)
                if temporary_echo is not None:
                    temporary_echo.unlink(missing_ok=True)
                if raw_candidate is not None and _is_download_candidate(
                    raw_candidate, configured.storage_dir
                ):
                    raw_candidate.unlink(missing_ok=True)

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
            return _perform_refresh()
        except RadarMetadataError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception as exc:
            # Sans trace, un échec du cron n'est qu'un 502 muet : on journalise
            # côté Railway et on nomme la cause dans la réponse (le message
            # d'exception ne transporte ni clé API ni jeton).
            traceback.print_exc(file=sys.stdout)
            sys.stdout.flush()
            raise HTTPException(
                status_code=502,
                detail=f"radar refresh failed: {type(exc).__name__}: {exc}",
            ) from exc

    # ─── Boucle interne : le cron externe n'est qu'une ceinture de sécurité ──
    scheduler_task: asyncio.Task[None] | None = None

    async def _refresh_periodically() -> None:
        while True:
            try:
                await asyncio.to_thread(_perform_refresh)
            except Exception as exc:  # noqa: BLE001 — la boucle doit survivre
                print(
                    "[radar-worker] rafraîchissement planifié en échec : "
                    f"{type(exc).__name__}: {exc}",
                    flush=True,
                )
                traceback.print_exc(file=sys.stdout)
                sys.stdout.flush()
            await asyncio.sleep(configured.refresh_interval_seconds)

    @application.on_event("startup")
    async def _start_scheduler() -> None:
        nonlocal scheduler_task
        if configured.refresh_interval_seconds > 0 and configured.configured:
            scheduler_task = asyncio.create_task(_refresh_periodically())

    @application.on_event("shutdown")
    async def _stop_scheduler() -> None:
        if scheduler_task is not None:
            scheduler_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await scheduler_task

    @application.post("/publish")
    def publish(
        request: PublishRequest,
        authorization: str | None = Header(default=None),
    ) -> JSONResponse:
        expected = f"Bearer {configured.worker_token}"
        if not configured.worker_token or authorization is None or not secrets.compare_digest(
            authorization, expected
        ):
            raise HTTPException(status_code=401, detail="invalid worker token")

        try:
            image = base64.b64decode(request.imageBase64, validate=True)
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail="imageBase64 is not valid base64") from exc
        if len(image) > MAX_PUBLISH_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="radar raster exceeds the size cap")
        if len(image) < 12 or image[:4] != b"RIFF" or image[8:12] != b"WEBP":
            raise HTTPException(status_code=400, detail="radar raster must be a WebP image")
        try:
            manifest_fields = validated_publish_manifest(request.manifest)
        except RadarMetadataError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        observed = _parse_utc_instant(manifest_fields["observedAt"])
        with refresh_lock:
            current = _read_manifest(manifest_path)
            if current is not None:
                try:
                    current_observed = _parse_utc_instant(current.get("observedAt"))
                except RadarMetadataError:
                    current_observed = None
                if current_observed is not None:
                    if observed < current_observed:
                        raise HTTPException(
                            status_code=409,
                            detail="a newer radar observation is already published",
                        )
                    if observed == current_observed:
                        return JSONResponse(current)

            version = observed.strftime("%Y%m%dT%H%MZ")
            content_hash = hashlib.sha256(image).hexdigest()
            image_name = f"radar-{version}-{content_hash}.webp"
            published_image = raster_dir / image_name
            temporary_image: Path | None = None
            created_image = False
            try:
                with tempfile.NamedTemporaryFile(
                    dir=raster_dir,
                    prefix=".publish-",
                    suffix=".tmp",
                    delete=False,
                ) as stream:
                    temporary_image = Path(stream.name)
                    stream.write(image)
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary_image, published_image)
                    created_image = True
                except FileExistsError:
                    pass
                public_manifest = {
                    **manifest_fields,
                    "imageUrl": (
                        f"{configured.public_base_url.rstrip('/')}/rasters/{image_name}"
                    ),
                }
                manifest_writer(manifest_path, public_manifest)
                try:
                    _prune_files(
                        raster_dir,
                        "radar-*.webp",
                        keep=configured.raster_retention,
                        protected={published_image.resolve()},
                    )
                except OSError:
                    pass
                return JSONResponse(public_manifest)
            except HTTPException:
                raise
            except Exception as exc:
                if created_image:
                    published_image.unlink(missing_ok=True)
                raise HTTPException(status_code=502, detail="radar publish failed") from exc
            finally:
                if temporary_image is not None:
                    temporary_image.unlink(missing_ok=True)

    return application


app = create_app()
