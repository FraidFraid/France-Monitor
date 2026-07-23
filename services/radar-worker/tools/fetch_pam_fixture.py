"""Télécharge des fixtures PAM (et mosaïque appariée) pour les tests différentiels.

Usage :
  METEO_FRANCE_RADAR_API_KEY=… python3 tools/fetch_pam_fixture.py 41 A /chemin/sortie/
Produit : pam-<station>-<tour>-<YYYYMMDDTHHMMZ>.bufr (+ .json de métadonnées).
"""
from __future__ import annotations

import gzip
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

BASE = "https://public-api.meteofrance.fr/public/DPRadar/v1"


def main() -> None:
    station, tour, out_dir = int(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    key = os.environ["METEO_FRANCE_RADAR_API_KEY"]
    headers = {"apikey": key}
    catalog = httpx.get(
        f"{BASE}/stations/{station}/observations/PAM", headers=headers, timeout=30.0
    ).json()
    link = next(
        l for l in catalog["links"]
        if f"tour_antenne={tour}" in str(l.get("href", ""))
    )
    validity = link["validity_time"].replace("-", "").replace(":", "")[:13] + "Z"
    raw = httpx.get(
        link["href"],
        headers={**headers, "Accept": "application/octet-stream"},
        timeout=60.0,
    ).content
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"pam-{station}-{tour}-{validity}.bufr"
    path.write_bytes(raw)
    meta = {"station": station, "tour": tour, "validityTime": link["validity_time"],
            "fetchedAt": datetime.now(timezone.utc).isoformat()}
    path.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    print(path)


if __name__ == "__main__":
    main()
