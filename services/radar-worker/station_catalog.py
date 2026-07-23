"""Catalogue des stations radar métropole — GÉNÉRÉ, ne pas éditer.

Régénération : tools/build_station_catalog.py (coordonnées relevées
dans les BUFR PAM, structure ZH validée strictement)."""
from __future__ import annotations

import math
from dataclasses import dataclass

MAX_RANGE_M = 160_000


@dataclass(frozen=True)
class Station:
    station_id: int
    name: str
    latitude: float
    longitude: float


STATIONS: dict[int, Station] = {
    36: Station(36, 'NOYAL', 48.04694, -2.89417),
    37: Station(37, 'AJACCIO', 41.95306, 8.70056),
    38: Station(38, 'ST-REMY', 46.06639, 2.96056),
    40: Station(40, 'ABBEVILLE', 50.13583, 1.83472),
    41: Station(41, 'BORDEAUX', 44.83139, -0.69194),
    42: Station(42, 'BOURGES', 47.05861, 2.35944),
    43: Station(43, 'MOUCHEROTTE', 45.14778, 5.63944),
    44: Station(44, 'BRIVE GREZES', 45.10444, 1.36972),
    45: Station(45, 'FALAISE CAEN', 48.92722, -0.14944),
    47: Station(47, 'NANCY', 48.71583, 6.58167),
    49: Station(49, 'NIMES', 43.80611, 4.50278),
    50: Station(50, 'TOULOUSE', 43.57444, 1.37611),
    51: Station(51, 'TRAPPES', 48.77444, 2.00833),
    52: Station(52, 'ARCIS TROYES', 48.46222, 4.30944),
    54: Station(54, 'TREILLIERES', 47.3375, -1.65639),
    56: Station(56, 'PLABENNEC', 48.46083, -4.42972),
    57: Station(57, 'OPOUL', 42.91833, 2.865),
    58: Station(58, 'ST.NIZIER', 46.06778, 4.44528),
    59: Station(59, 'COLLOBRIERES', 43.21667, 6.37278),
    61: Station(61, 'ALERIA', 42.12972, 9.49639),
    62: Station(62, 'MONTCLAR', 43.99056, 2.60972),
    63: Station(63, "L'AVESNOIS", 50.12833, 3.81194),
    65: Station(65, 'BLAISY-HAUT', 47.35528, 4.77583),
    66: Station(66, 'MOMUY', 43.62444, -0.60944),
    67: Station(67, 'MONTANCY', 47.36861, 7.01889),
    68: Station(68, 'MAUREL', 44.01278, 6.52917),
    69: Station(69, 'COLOMBIS', 44.49611, 6.22056),
}


def nearest_station(lat: float, lon: float):
    """Station la plus proche, ou None si au-delà de MAX_RANGE_M."""
    best, best_distance = None, float('inf')
    for station in STATIONS.values():
        p1, p2 = math.radians(lat), math.radians(station.latitude)
        dp = math.radians(station.latitude - lat)
        dl = math.radians(station.longitude - lon)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        distance = 2 * 6_371_000.0 * math.asin(math.sqrt(a))
        if distance < best_distance:
            best, best_distance = station, distance
    if best is None or best_distance > MAX_RANGE_M:
        return None
    return best, best_distance
