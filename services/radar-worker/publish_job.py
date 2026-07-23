"""Production déportée : décode le BUFR DPRadar sur un runner externe
(GitHub Actions) et pousse manifeste + raster au worker via POST /publish.

Le décodage eccodes exige plusieurs Go de RAM ; les runners publics GitHub
en offrent 16, le worker Railway n'en a pas autant.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path
import sys
import tempfile
from typing import Any, Mapping

import httpx

from bufr_decoder import decode_bufr
from models import build_manifest
from radar_api import RadarApiClient
from render import render_reflectivity

PUBLISH_TIMEOUT_SECONDS = 120.0


def build_publish_payload(
    grid: Mapping[str, Any],
    image: bytes,
    *,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Assemble le corps de POST /publish ; l'imageUrl reste au worker."""

    manifest = dict(
        build_manifest(
            grid,
            public_base_url="https://placeholder.invalid",
            generated_at=generated_at,
        )
    )
    del manifest["imageUrl"]
    return {
        "manifest": manifest,
        "imageBase64": base64.b64encode(image).decode("ascii"),
    }


def run() -> dict[str, Any]:
    api_key = os.environ["METEO_FRANCE_RADAR_API_KEY"]
    worker_token = os.environ["RADAR_WORKER_TOKEN"]
    publish_base_url = os.environ["RADAR_PUBLISH_BASE_URL"].rstrip("/")

    api = RadarApiClient(api_key)
    product = api.discover_latest()
    print(f"produit DPRadar : observation {product.observed_at}", flush=True)

    with tempfile.TemporaryDirectory(prefix="radar-publish-") as workdir:
        raw = api.download(product, Path(workdir))
        print(f"BUFR téléchargé : {raw.stat().st_size} octets", flush=True)
        grid = decode_bufr(raw, observed_at=product.observed_at)
        print("grille décodée et validée", flush=True)

        rendered = Path(workdir) / "radar.webp"
        render_reflectivity(
            grid["values"],
            width=grid["width"],
            height=grid["height"],
            output=rendered,
        )
        payload = build_publish_payload(grid, rendered.read_bytes())

    response = httpx.post(
        f"{publish_base_url}/publish",
        json=payload,
        headers={"Authorization": f"Bearer {worker_token}"},
        timeout=PUBLISH_TIMEOUT_SECONDS,
    )
    if response.status_code == 409:
        # Une observation au moins aussi récente est déjà en ligne : succès.
        print("observation déjà publiée, rien à faire", flush=True)
        return response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    response.raise_for_status()
    manifest = response.json()
    print(f"publié : {manifest['imageUrl']} (observation {manifest['observedAt']})", flush=True)
    return manifest


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:  # noqa: BLE001 — le runner doit voir l'échec en clair
        print(f"échec de la publication radar : {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1) from exc
