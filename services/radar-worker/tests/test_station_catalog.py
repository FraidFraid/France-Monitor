"""Catalogue des stations : contenu généré + sélection de la plus proche."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from station_catalog import MAX_RANGE_M, STATIONS, nearest_station  # noqa: E402


def test_catalog_carries_bordeaux_with_bufr_coordinates():
    bordeaux = STATIONS[41]
    assert bordeaux.name == "BORDEAUX"
    assert bordeaux.latitude == pytest.approx(44.83139, abs=1e-4)
    assert bordeaux.longitude == pytest.approx(-0.69194, abs=1e-4)


def test_catalog_is_metropole_only():
    for station in STATIONS.values():
        assert 41.0 <= station.latitude <= 52.0, station
        assert -6.0 <= station.longitude <= 10.0, station


def test_nearest_station_from_dax_is_momuy():
    # NOTE (déviation documentée, cf. task-5-report.md) : le brief original
    # attendait Bordeaux (id 41, ≈125 km) comme station la plus proche de
    # Dax. Le catalogue complet (32 stations réelles) révèle que Momuy
    # (id 66, Landes) est en fait à ≈36,7 km de Dax — bien plus proche.
    # Coordonnées de Momuy contre-vérifiées via l'oracle eccodes (identiques
    # au bit près : 43.62444 / -0.60944), donc ce n'est pas un bug de
    # décodage : l'hypothèse géographique du brief était incomplète.
    result = nearest_station(43.71, -1.05)  # Dax ≈ 37 km de Momuy radar
    assert result is not None
    station, distance_m = result
    assert station.station_id == 66
    assert 30_000 < distance_m < 45_000


def test_out_of_range_returns_none():
    # Milieu du golfe de Gascogne : > 160 km de tout radar métropole.
    assert nearest_station(45.5, -5.5) is None
    assert MAX_RANGE_M == 160_000
