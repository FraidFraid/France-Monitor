"""Génère station_catalog.py depuis l'API DPRadar + coordonnées BUFR.

Pour chaque station listée par /stations : télécharge un tour PAM, décode
strictement le message ZH (validation de structure incluse) et relève les
coordonnées embarquées. Les stations hors métropole ou dont le décodage
échoue sont listées sur stderr et exclues du catalogue.

Usage : METEO_FRANCE_RADAR_API_KEY=… venv/bin/python3 tools/build_station_catalog.py > station_catalog.py
"""
from __future__ import annotations

import gzip
import os
import re
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pam_bitstream import parse_zh_scan, select_zh_message, split_messages  # noqa: E402

BASE = "https://public-api.meteofrance.fr/public/DPRadar/v1"
BBOX = (41.0, 52.0, -6.0, 10.0)  # lat min/max, lon min/max — métropole + Corse


def main() -> None:
    headers = {"apikey": os.environ["METEO_FRANCE_RADAR_API_KEY"]}
    stations_doc = httpx.get(f"{BASE}/stations", headers=headers, timeout=30.0).json()
    entries: list[tuple[int, str, float, float]] = []
    for link in stations_doc.get("links", []):
        match = re.search(r"/stations/(\d+)$", str(link.get("href", "")))
        if not match:
            continue
        station_id = int(match.group(1))
        name = str(link.get("title", "")).replace("Station RADAR ", "").strip()
        try:
            catalog = httpx.get(
                f"{BASE}/stations/{station_id}/observations/PAM",
                headers=headers, timeout=30.0,
            ).json()
            product = next(
                l["href"] for l in catalog.get("links", [])
                if "tour_antenne=" in str(l.get("href", ""))
            )
            raw = httpx.get(
                product, headers={**headers, "Accept": "application/octet-stream"},
                timeout=60.0,
            ).content
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            scan = parse_zh_scan(select_zh_message(split_messages(raw)))
        except Exception as exc:  # noqa: BLE001 — outil de génération
            print(f"# exclu {station_id} {name}: {exc}", file=sys.stderr)
            continue
        lat, lon = scan.station_latitude, scan.station_longitude
        if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lon <= BBOX[3]):
            print(f"# hors métropole {station_id} {name}", file=sys.stderr)
            continue
        entries.append((station_id, name, lat, lon))

    print('"""Catalogue des stations radar métropole — GÉNÉRÉ, ne pas éditer.')
    print()
    print("Régénération : tools/build_station_catalog.py (coordonnées relevées")
    print('dans les BUFR PAM, structure ZH validée strictement)."""')
    print("from __future__ import annotations")
    print()
    print("import math")
    print("from dataclasses import dataclass")
    print()
    print("MAX_RANGE_M = 160_000")
    print()
    print()
    print("@dataclass(frozen=True)")
    print("class Station:")
    print("    station_id: int")
    print("    name: str")
    print("    latitude: float")
    print("    longitude: float")
    print()
    print()
    print("STATIONS: dict[int, Station] = {")
    for station_id, name, lat, lon in sorted(entries):
        print(
            f"    {station_id}: Station({station_id}, {name!r}, {lat!r}, {lon!r}),"
        )
    print("}")
    print()
    print()
    print("def nearest_station(lat: float, lon: float):")
    print('    """Station la plus proche, ou None si au-delà de MAX_RANGE_M."""')
    print("    best, best_distance = None, float('inf')")
    print("    for station in STATIONS.values():")
    print("        p1, p2 = math.radians(lat), math.radians(station.latitude)")
    print("        dp = math.radians(station.latitude - lat)")
    print("        dl = math.radians(station.longitude - lon)")
    print("        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2")
    print("        distance = 2 * 6_371_000.0 * math.asin(math.sqrt(a))")
    print("        if distance < best_distance:")
    print("            best, best_distance = station, distance")
    print("    if best is None or best_distance > MAX_RANGE_M:")
    print("        return None")
    print("    return best, best_distance")


if __name__ == "__main__":
    main()
