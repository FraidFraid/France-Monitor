"""Calibration code→dBZ du ZH PAM : oracle embarqué + contre-vérif mosaïque.

ORACLE PRINCIPAL (indépendant de la météo) — `test_embedded_lut_confirms_conversion` :
le message ZH embarque sa propre table code→dBZ (séquence locale 321193, deux
bornes `021216` par code). Relue via eccodes, elle donne la conversion du
constructeur — rampe identité de casiers larges de 1 dBZ, code 79 = saturation —
soit `dbz(centre) = 1.0 * code − 10.5`. C'est elle qui VERROUILLE
`ZH_DBZ_GAIN` / `ZH_DBZ_OFFSET` ; ce test doit être vert dès qu'une fixture PAM
est fournie, sans dépendre de la pluie.

CONTRE-VÉRIFICATION SECONDAIRE (dépend de la pluie) —
`test_affine_calibration_and_spatial_agreement` : sur une paire PAM+mosaïque du
même cycle, on confronte le champ PAM basse élévation à la mosaïque 2D. Deux
mesures indépendantes :
1. ajustement affine par quantiles (insensible aux petits décalages spatiaux) →
   doit retomber sur la famille confirmée (gain ≈ 1, offset ≈ −10,5) ;
2. corrélation spatiale des valeurs converties → valide l'ordre des azimuts et
   la géométrie (un mauvais mapping effondre r).
Un garde-fou météo honnête saute ce test quand la pluie co-localisée est
insuffisante pour un ajustement significatif (voir les seuils plus bas) : il ne
peut donc ni échouer à tort par temps calme, ni « passer à vide ». Quand il
s'exécute vraiment, AUCUN seuil n'est relâché.

NB (T3) : `_mosaic_grid` ajoute la clé « bounds » (WGS84) au grid renvoyé par
decode_bufr, qui ne l'expose pas ; c'est exactement la boîte dans laquelle
l'affichage carte place la mosaïque (models.wgs84_bounds → build_manifest), donc
le mapping linéaire ci-dessous reproduit l'approximation de la carte.
"""
from __future__ import annotations

import math
import os
import re
import sys
from pathlib import Path

import numpy as np
import pytest

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

# eccodes (oracle principal) a besoin des tables locales Météo-France
# (centre 85) embarquées dans le dépôt ; on les injecte avant tout appel.
_LOCAL_DEFINITIONS = WORKER_DIR / "eccodes-definitions"
if _LOCAL_DEFINITIONS.is_dir():
    _existing = os.environ.get("ECCODES_DEFINITION_PATH", "")
    if str(_LOCAL_DEFINITIONS) not in _existing:
        os.environ["ECCODES_DEFINITION_PATH"] = (
            f"{_LOCAL_DEFINITIONS}:{_existing}"
            if _existing
            else f"{_LOCAL_DEFINITIONS}:/MEMFS/definitions"
        )

PAM_FIXTURE = os.environ.get("RADAR_PAM_LOW_FIXTURE", "")
MOSAIC_FIXTURE = os.environ.get("RADAR_BUFR_FIXTURE", "")

# L'oracle principal ne dépend que de la fixture PAM ; la contre-vérif exige la
# paire complète PAM + mosaïque. Marqueurs SÉPARÉS (pas de pytestmark global,
# qui skipperait aussi l'oracle faute de mosaïque).
_has_pam = bool(PAM_FIXTURE and Path(PAM_FIXTURE).is_file())
_has_pair = _has_pam and bool(MOSAIC_FIXTURE and Path(MOSAIC_FIXTURE).is_file())

lut_marker = pytest.mark.skipif(
    not _has_pam,
    reason="fixture PAM absente : oracle LUT eccodes réservé au dev",
)
mosaic_marker = pytest.mark.skipif(
    not _has_pair,
    reason="paire de fixtures PAM+mosaïque absente : contre-vérif réservée au dev",
)

RADIUS_KM = 120.0
# Garde-fou météo (contre-vérif mosaïque) : deux conditions cumulatives.
MIN_RAINY_PIXELS = 500      # taille d'échantillon minimale pour des quantiles stables
STRONG_DBZ = 25.0           # seuil « pluie franche » (~1–2 mm/h, bien au-dessus du fouillis/bruine)
MIN_STRONG_PIXELS = 30      # casiers ≥25 dBZ co-localisés requis pour un ajustement significatif


# ---------------------------------------------------------------------------
# Oracle PRINCIPAL : la table code→dBZ embarquée (indépendante de la météo).
# ---------------------------------------------------------------------------


@lut_marker
def test_embedded_lut_confirms_conversion():
    """La table 321193/021216 fixe la conversion sans dépendre de la pluie.

    Contrat observé (stations 41 et 63, tous les tours) : rampe identité de
    80 codes, chacun accompagné de deux bornes de réflectivité (021216, dBZ).
    Les codes 0..10 valent [0, 0] (pas d'écho / sous le seuil), les codes
    11..78 sont des casiers larges de 1 dBZ [k−11, k−10] (centre = k − 10,5),
    et le code 79 est le casier de saturation [68, 100]. Le centre suit donc
    dbz = 1,0 * code − 10,5 : c'est la conversion verrouillée du module.
    """
    eccodes = pytest.importorskip("eccodes")
    from pam_bitstream import (
        ZH_DBZ_GAIN,
        ZH_DBZ_OFFSET,
        select_zh_message,
        split_messages,
    )

    zh = select_zh_message(split_messages(Path(PAM_FIXTURE).read_bytes()))
    tmp = Path("/tmp/calibration-lut-zh.bufr")
    tmp.write_bytes(zh.raw)
    with tmp.open("rb") as stream:
        handle = eccodes.codes_bufr_new_from_file(stream)
        eccodes.codes_set(handle, "unpack", 1)
        bounds = np.array(
            eccodes.codes_get_array(handle, "meteoFranceLocal021216"), dtype=np.float64
        )
        eccodes.codes_release(handle)

    # 80 codes × 2 bornes, entrelacées [inf0, sup0, inf1, sup1, …].
    assert bounds.size == 160, f"attendu 160 bornes 021216, obtenu {bounds.size}"
    lut = bounds.reshape(80, 2)
    lower, upper = lut[:, 0], lut[:, 1]
    codes = np.arange(80)

    # Région linéaire : casiers larges de 1 dBZ, hors code 79 (saturation).
    linear = (codes >= 11) & (codes <= 78)
    assert np.allclose(upper[linear] - lower[linear], 1.0), "casiers non larges de 1 dBZ"
    assert upper[79] >= 68.0, "le code 79 doit être le casier de saturation"

    center = (lower + upper) / 2.0
    gain_lut, offset_lut = np.polyfit(codes[linear], center[linear], 1)
    print(f"LUT embarquée : dbz(centre) = {gain_lut:.4f} * code + {offset_lut:.4f}")
    assert gain_lut == pytest.approx(1.0, abs=1e-6)
    assert offset_lut == pytest.approx(-10.5, abs=1e-6)

    # Le module DOIT adopter la conversion du constructeur.
    assert ZH_DBZ_GAIN == pytest.approx(gain_lut, abs=0.1), (
        f"ZH_DBZ_GAIN={ZH_DBZ_GAIN} incohérent avec la LUT ({gain_lut:.3f})"
    )
    assert ZH_DBZ_OFFSET == pytest.approx(offset_lut, abs=0.1)


# ---------------------------------------------------------------------------
# Contre-vérification SECONDAIRE : confrontation à la mosaïque 2D (météo-dépendante).
# ---------------------------------------------------------------------------


def _mosaic_grid():
    from bufr_decoder import decode_bufr
    from models import wgs84_bounds
    stamp = re.search(r"radar-(\d{8})T(\d{4})Z", Path(MOSAIC_FIXTURE).name)
    assert stamp
    date, time = stamp.group(1), stamp.group(2)
    observed = f"{date[:4]}-{date[4:6]}-{date[6:]}T{time[:2]}:{time[2:]}:00Z"
    grid = decode_bufr(Path(MOSAIC_FIXTURE), observed_at=observed)
    # decode_bufr n'expose pas « bounds » : on la calcule comme l'affichage
    # carte (models.wgs84_bounds → manifest.bounds → BitmapLayer WGS84).
    grid["bounds"] = wgs84_bounds(grid)
    return grid


@mosaic_marker
def test_affine_calibration_and_spatial_agreement():
    from pam_bitstream import (
        ZH_DBZ_GAIN,
        ZH_DBZ_OFFSET,
        parse_zh_scan,
        select_zh_message,
        split_messages,
    )
    from polar_geometry import beam_ground_distance_m, destination_point

    scan = parse_zh_scan(select_zh_message(split_messages(Path(PAM_FIXTURE).read_bytes())))
    grid = _mosaic_grid()
    west, south, east, north = grid["bounds"]
    width, height = grid["width"], grid["height"]
    mosaic = np.array(
        [np.nan if v is None else v for v in grid["values"]], dtype=np.float64
    ).reshape(height, width)

    # Chaque porte PAM sous 120 km → lat/lon → pixel mosaïque (mapping
    # linéaire dans les bounds, même approximation que l'affichage carte).
    pam_codes, mosaic_dbz = [], []
    for az_index in range(scan.azimuth_count):
        bearing = (scan.azimuth_start_deg + az_index * scan.azimuth_step_deg) % 360.0
        for gate_index in range(scan.gate_count):
            slant = (gate_index + 0.5) * scan.gate_length_m
            ground = beam_ground_distance_m(slant, scan.elevation_deg)
            if ground > RADIUS_KM * 1000.0:
                break
            code = int(scan.codes[az_index, gate_index])
            if code in (0, 255):
                continue
            lat, lon = destination_point(
                scan.station_latitude, scan.station_longitude, bearing, ground
            )
            col = int((lon - west) / (east - west) * width)
            row = int((north - lat) / (north - south) * height)
            if not (0 <= col < width and 0 <= row < height):
                continue
            value = mosaic[row, col]
            if math.isnan(value) or value == -40.0:
                continue
            pam_codes.append(code)
            mosaic_dbz.append(value)

    codes = np.array(pam_codes, dtype=np.float64)
    reference = np.array(mosaic_dbz, dtype=np.float64)

    # Garde-fou météo HONNÊTE : un ajustement affine et une corrélation ne sont
    # significatifs que s'il y a (a) assez d'échantillons co-localisés pour des
    # quantiles stables ET (b) assez de vraie pluie (≥25 dBZ) pour peupler la
    # bande haute des quantiles (0,60–0,99) et donner un signal spatial. Sinon
    # les co-loc sont dominés par le fouillis de sol / l'écho faible et le test
    # échouerait à tort. On saute alors, sans jamais relâcher les seuils.
    strong = int(np.count_nonzero(reference >= STRONG_DBZ))
    if codes.size < MIN_RAINY_PIXELS or strong < MIN_STRONG_PIXELS:
        pytest.skip(
            "pluie co-localisée insuffisante pour un ajustement significatif : "
            f"{codes.size} px co-localisés (requis ≥ {MIN_RAINY_PIXELS}), "
            f"{strong} px ≥ {STRONG_DBZ:.0f} dBZ (requis ≥ {MIN_STRONG_PIXELS}) "
            "— météo trop calme dans la portée de la station"
        )

    # 1. Ajustement affine par quantiles appariés → famille 1 dBZ confirmée.
    quantiles = np.linspace(0.60, 0.99, 40)
    gain, offset = np.polyfit(
        np.quantile(codes, quantiles), np.quantile(reference, quantiles), 1
    )
    print(f"calibration: dbz = {gain:.4f} * code + {offset:.4f}")
    assert 0.8 <= gain <= 1.2, "gain hors de la famille confirmée (1 dBZ par code)"
    assert -20.0 <= offset <= 0.0, "offset hors de la plage plausible"

    # 2. Accord spatial : corrélation des valeurs converties.
    converted = gain * codes + offset
    r = float(np.corrcoef(converted, reference)[0, 1])
    print(f"corrélation spatiale r = {r:.3f} sur {codes.size} px")
    assert r > 0.5, "corrélation effondrée : géométrie ou ordre des azimuts faux"

    # 3. La formule verrouillée dans le module doit coller à l'ajustement.
    assert abs(ZH_DBZ_GAIN - gain) <= 0.1
    assert abs(ZH_DBZ_OFFSET - offset) <= 3.0
