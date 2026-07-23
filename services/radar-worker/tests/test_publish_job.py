from __future__ import annotations

import base64
from pathlib import Path
import sys

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from app import validated_publish_manifest
from publish_job import build_publish_payload


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
            "latitudeOfTrueScale": 45,
            "centralMeridian": 0,
            "falseEasting": 0,
            "falseNorthing": 0,
        },
        # Origine NW du produit réel (-9.965, 53.67) reprojetée — une grille
        # pôle-centrée donnerait des bounds dégénérés (south == north).
        "upperLeftProjected": [-619652, -3526818],
        "values": [161],
    }


WEBP = b"RIFF" + (8).to_bytes(4, "little") + b"WEBPdata"


def test_build_publish_payload_matches_worker_contract():
    payload = build_publish_payload(
        _grid(), WEBP, generated_at="2026-07-16T12:52:00Z"
    )

    manifest = payload["manifest"]
    assert "imageUrl" not in manifest
    # Le worker doit accepter tel quel ce que le producteur émet.
    validated = validated_publish_manifest(manifest)
    assert validated["observedAt"] == "2026-07-16T12:50:00Z"
    assert validated["generatedAt"] == "2026-07-16T12:52:00Z"
    assert validated["resolutionMeters"] == 1000
    assert base64.b64decode(payload["imageBase64"], validate=True) == WEBP
