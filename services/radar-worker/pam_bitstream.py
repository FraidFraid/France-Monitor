"""Lecture directe du train de bits des messages PAM (BUFR édition 2).

Un fichier PAM = un tour d'antenne = 6 messages BUFR concaténés, un par
paramètre. Seul le message ZH (dataSubCategory 0) est décodé ; les autres
sont ignorés. Même philosophie que bufr_bitstream (IMFR27) : toute
déviation du contrat observé lève RadarMetadataError, eccodes reste
l'oracle des tests différentiels et n'entre jamais dans le runtime.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from bufr_bitstream import BitReader
from models import RadarMetadataError


@dataclass(frozen=True)
class PamMessage:
    offset: int
    length: int
    data_subcategory: int
    local_tables_version: int
    raw: bytes


def split_messages(data: bytes) -> list[PamMessage]:
    """Découpe le fichier en messages BUFR édition 2 complets."""
    messages: list[PamMessage] = []
    offset = 0
    while offset < len(data):
        if data[offset : offset + 4] != b"BUFR":
            raise RadarMetadataError("PAM payload must be a sequence of BUFR messages")
        if offset + 8 > len(data):
            raise RadarMetadataError("PAM BUFR header is truncated")
        length = int.from_bytes(data[offset + 4 : offset + 7])
        if data[offset + 7] != 2:
            raise RadarMetadataError("PAM BUFR must be edition 2")
        if offset + length > len(data) or length < 30:
            raise RadarMetadataError("PAM BUFR message length is inconsistent")
        raw = data[offset : offset + length]
        if raw[-4:] != b"7777":
            raise RadarMetadataError("PAM BUFR is truncated (missing 7777 terminator)")
        # Section 1 (édition 2) : octet 9 = catégorie, 10 = sous-catégorie,
        # 12 = version tables locales (offsets relatifs au début de section).
        s1 = raw[8:]
        centre = s1[5]
        category = s1[8]
        subcategory = s1[9]
        local_version = s1[11]
        if centre != 85 or category != 6:
            raise RadarMetadataError(
                f"unexpected PAM BUFR origin: centre {centre}, category {category}"
            )
        messages.append(
            PamMessage(
                offset=offset,
                length=length,
                data_subcategory=subcategory,
                local_tables_version=local_version,
                raw=raw,
            )
        )
        offset += length
    if not messages:
        raise RadarMetadataError("PAM payload carries no BUFR message")
    return messages


def select_zh_message(messages: list[PamMessage]) -> PamMessage:
    """Le message réflectivité horizontale est l'unique dataSubCategory 0."""
    matches = [m for m in messages if m.data_subcategory == 0]
    if len(matches) != 1:
        raise RadarMetadataError("PAM file must carry exactly one ZH message")
    return matches[0]


# ---------------------------------------------------------------------------
# Marche bit à bit du message ZH (tables maîtres v11 + locales 20/85).
# Layout relevé par tools/probe_pam_layout.py le 2026-07-23 (station 41) et
# verrouillé par tests/test_pam_differential.py contre eccodes.
# ---------------------------------------------------------------------------

# Séquence section 3 du message ZH PAM (82 descripteurs, relevée le
# 2026-07-23 sur la station 41). Comparaison STRICTE, comme IMFR27.
EXPECTED_ZH_SECTION3_DESCRIPTORS: tuple[str, ...] = (
    "321011", "301011", "301013", "301001", "301021", "002205", "002193",
    "025060", "321010", "201131", "202129", "002106", "202000", "201000",
    "002207", "025004", "201135", "202130", "002121", "202000", "201000",
    "002122", "002123", "002124", "105000", "031001", "201131", "202129",
    "002125", "202000", "201000", "002126", "002127", "002128", "201131",
    "002129", "201000", "002130", "002131", "005196", "055233", "101000",
    "031192", "025201", "321006", "321007", "002136", "002198", "321192",
    "002199", "002206", "321196", "005033", "006033", "030021", "030022",
    "029001", "030192", "008021", "004025", "004026", "049239", "321193",
    "049193", "049194", "049195", "049211", "007021", "002134", "010007",
    "049220", "049221", "049222", "049223", "101000", "031001", "048192",
    "103000", "031192", "201132", "030001", "201000",
)

# Versions de tables verrouillées : la marche dépend de leurs largeurs.
EXPECTED_MASTER_TABLES_VERSION = 11
EXPECTED_LOCAL_TABLES_VERSION = 20

# Largeurs/échelles/références (tables B maîtres v11 et locales 20/85,
# relevées par tools/probe_pam_layout.py). Aucune valeur magique en ligne.
W_030031 = 4     # pictureType
W_030032 = 16    # combinationWithOtherData
W_029002 = 3     # coordinateGridType
W_YEAR, W_MONTH, W_DAY = 12, 4, 6          # 301011
W_HOUR, W_MINUTE, W_SECOND = 5, 6, 6       # 301013
W_001001 = 7     # blockNumber
W_001002 = 10    # stationNumber
W_005001, S_005001, R_005001 = 25, 5, -9000000   # latitude (haute précision)
W_006001, S_006001, R_006001 = 26, 5, -18000000  # longitude
W_002205 = 8     # type de radar (local)
W_002193 = 8     # type de calculateur (local)
W_025060 = 14    # identification du logiciel
# Séquence 321010 : caractéristiques d'antenne. Seul 007002 (altitude de
# l'antenne, clé eccodes « height » dans les tables maîtres v11) est extrait.
W_002101 = 4     # typeOfAntenna
W_007002, S_007002, R_007002 = 16, -1, -40   # altitude de l'antenne, m
W_321010_TAIL = 8 + 2 + 4 + 6 + 6 + 6 + 6 + 12 + 12 + 6 + 6
W_002106 = 6     # 3-dB beamwidth ; opérateurs 201131/202129 => 9 bits
W_002106_MOD = W_002106 + 3
W_002207 = 2     # sens de balayage en azimut (local)
W_025004 = 2     # echoProcessing
W_002121 = 7     # meanFrequency ; opérateurs 201135/202130 => 14 bits
W_002121_MOD = W_002121 + 7
W_002122 = 8     # frequencyAgilityRange
W_002123 = 7     # peakPower
W_002124 = 7     # averagePower
W_031001 = 8     # delayedDescriptorReplicationFactor
W_002125 = 8     # pulseRepetitionFrequency ; opérateur 201131 => 11 bits
W_002125_MOD = W_002125 + 3
W_002126 = 6     # pulseWidth
W_002127 = 7     # receiverIntermediateFrequency
W_002128 = 6     # intermediateFrequencyBandwidth
W_002129 = 5     # minimumDetectableSignal ; opérateur 201131 => 8 bits
W_002129_MOD = W_002129 + 3
W_002130 = 7     # dynamicRange
W_002131 = 2     # sensitivityTimeControl
W_005196, S_005196 = 10, 2   # incrément d'azimut entre chaque tir (local)
W_055233 = 16    # longueur de la porte distance après intégration, m (local)
W_031192 = 32    # facteur super élargi de répétition différé (local)
W_025201 = 12    # niveau de bruit par radiale (local)
W_025001, S_025001 = 6, -1   # rangeGateLength (échelle -1 => mètres ×10)
W_025002 = 4     # numberOfGatesAveraged
W_025003 = 8     # numberOfIntegratedPulses
W_025005 = 2     # echoIntegration
# Séquence 321007 : corrections (025009..025017), intégralement sautée.
W_321007 = 4 + 4 + 2 + 2 + 2 + 2 + 6 + 2
W_002136 = 16    # rangeProcessedByRangeAttenuationCorrection
W_002198 = 8     # indicateur d'arrêt ou de panne (local)
W_002194 = 8     # indicateur du dernier étalonnage (local)
W_301012 = W_HOUR + W_MINUTE  # 301012 : heure/minute de l'étalonnage
W_002195 = 16    # fréquence du dernier étalonnage (local)
W_002196 = 16    # réglage bas du dernier étalonnage (local)
W_002197 = 16    # réglage haut du dernier étalonnage (local)
W_021217 = 16    # réflectivité théorique (local)
W_021218 = 16    # réflectivité mesurée (local)
W_002199 = 16    # constante radar (local)
W_002206 = 2     # indicateur de positionnement en site inhibé (local)
W_002135 = 15    # antennaElevation (site inhibé)
W_006194 = 16    # portée de début de traitement d'un site (local)
W_006195 = 16    # portée de fin de traitement d'un site (local)
W_005033 = 16    # pixelSizeOnHorizontal1 (manquant dans le produit)
W_006033 = 16    # pixelSizeOnHorizontal2 (manquant dans le produit)
W_030021 = 12    # numberOfPixelsPerRow  = portes par radiale
W_030022 = 12    # numberOfPixelsPerColumn = radiales par tour
W_029001 = 3     # projectionType
W_030192 = 8     # mode de balayage (local)
W_008021 = 5     # timeSignificance
W_004025 = 12    # timePeriod (minutes)
W_004026 = 13    # timePeriod (secondes)
W_049239 = 9     # correction globale mensuelle pluviomètre/radar (local)
W_031002 = 16    # extendedDelayedDescriptorReplicationFactor
W_021216 = 16    # réflectivité pour la valeur du pixel (local), ×2 par code
W_049193 = 4     # code de qualité arrêt-panne (local)
W_049194 = 4     # code de qualité étalonnage (local)
W_049195 = 4     # code de qualité éliminateur d'échos fixes (local)
W_049211 = 16    # CPTQ images émises par le calculateur radar (local)
W_007021, S_007021, R_007021 = 15, 2, -9000  # élévation du tour
W_002134, S_002134 = 16, 2                   # antennaBeamAzimuth (départ)
W_010007 = 17    # height (hauteur annexe, non extraite)
W_049220 = 7     # altitude de l'isotherme 0 °C du PVR (local)
W_049221 = 7     # taux de décroissance du PVR (local)
W_049222 = 5     # largeur de la bande brillante du PVR (local)
W_049223 = 7     # facteur du renforcement du PVR (local)
W_048192 = 1     # bit de calage (local)

ZH_CODE_WIDTH = 8          # 030001 base 4 bits + opérateur 201132 (+4)
ZH_CODE_MISSING = (1 << ZH_CODE_WIDTH) - 1
ZH_CODE_NO_ECHO = 0
# Conversion code→dBZ : valeurs provisoires de la famille « pas 0,5 dBZ »,
# VERROUILLÉES par tests/test_pam_calibration.py (Task 3) — ne modifier
# qu'avec une nouvelle calibration croisée mosaïque.
ZH_DBZ_GAIN = 0.5
ZH_DBZ_OFFSET = -10.5


def zh_dbz(codes: np.ndarray) -> np.ndarray:
    """Codes 8 bits → dBZ ; NaN pour manquant (255) et « pas d'écho » (0)."""
    values = codes.astype(np.float64) * ZH_DBZ_GAIN + ZH_DBZ_OFFSET
    values[(codes == ZH_CODE_MISSING) | (codes == ZH_CODE_NO_ECHO)] = np.nan
    return values


@dataclass(frozen=True)
class PolarScanZh:
    observed_at_utc: tuple[int, int, int, int, int, int]
    station_latitude: float
    station_longitude: float
    antenna_altitude_m: float
    elevation_deg: float
    azimuth_start_deg: float
    azimuth_step_deg: float
    azimuth_count: int
    gate_count: int
    gate_length_m: float
    codes: np.ndarray  # uint8 (azimuth_count, gate_count), 255 = manquant


def _descriptor_code(raw: int) -> str:
    return f"{raw >> 14}{(raw >> 8) & 0x3F:02d}{raw & 0xFF:03d}"


def _scaled(raw: int, scale: int, reference: int) -> float:
    return (raw + reference) / (10 ** scale)


def _required(reader: BitReader, width: int, code: str) -> int:
    """Lit une valeur extraite du scan ; le marqueur manquant est refusé."""
    raw = reader.read(width)
    if raw == (1 << width) - 1:
        raise RadarMetadataError(f"missing value for required descriptor {code}")
    return raw


def parse_zh_scan(message: PamMessage) -> PolarScanZh:
    """Marche stricte des sections 1/3/4 du message ZH, calquée sur IMFR27 :

    1. vérifier la séquence section 3 == EXPECTED_ZH_SECTION3_DESCRIPTORS ;
    2. marcher la section 4 avec BitReader (réutilisé de bufr_bitstream)
       en suivant l'expansion relevée par tools/probe_pam_layout.py —
       largeurs en constantes W_xxxxxx, réplications contrôlées
       (compte lu == compte attendu, sinon RadarMetadataError) ;
    3. extraire : horodatage (301011+301013), station (301001+301021 :
       lat/lon haute précision + altitude antenne 007002), élévation
       (007021), pas azimut (005196), portes (030021, longueurs 025001 et
       055233 exigées égales), azimut de départ (antennaBeamAzimuth
       002134), matrice codes (030001 sous 201132) ;
    4. exiger l'alignement final : reste < 16 bits, tous nuls.
    """
    if message.data_subcategory != 0:
        raise RadarMetadataError("parse_zh_scan expects the ZH message (subcategory 0)")
    raw = message.raw

    # Section 1 (édition 2) : versions de tables verrouillées — la marche
    # transcrit les largeurs des tables maîtres v11 / locales 20 centre 85.
    offset = 8
    s1_length = int.from_bytes(raw[offset : offset + 3])
    if s1_length < 18:
        raise RadarMetadataError("PAM BUFR section 1 is too short")
    master_version = raw[offset + 10]
    local_version = raw[offset + 11]
    if master_version != EXPECTED_MASTER_TABLES_VERSION:
        raise RadarMetadataError(
            f"unexpected BUFR masterTablesVersionNumber: {master_version};"
            f" expected {EXPECTED_MASTER_TABLES_VERSION}"
        )
    if local_version != EXPECTED_LOCAL_TABLES_VERSION:
        raise RadarMetadataError(
            f"unexpected BUFR localTablesVersionNumber: {local_version};"
            f" expected {EXPECTED_LOCAL_TABLES_VERSION}"
        )
    if raw[offset + 7] & 0x80:
        raise RadarMetadataError("unexpected optional BUFR section 2 in ZH message")
    offset += s1_length

    # Section 3 : un seul subset observé non compressé, séquence STRICTE.
    s3_length = int.from_bytes(raw[offset : offset + 3])
    subsets = int.from_bytes(raw[offset + 4 : offset + 6])
    s3_flags = raw[offset + 6]
    if subsets != 1:
        raise RadarMetadataError(f"unexpected BUFR numberOfSubsets: {subsets}; expected 1")
    if s3_flags != 0b1000_0000:
        raise RadarMetadataError("ZH BUFR must be observed and uncompressed")
    descriptor_count = (s3_length - 7) // 2
    descriptors = tuple(
        _descriptor_code(int.from_bytes(raw[offset + 7 + 2 * i : offset + 9 + 2 * i]))
        for i in range(descriptor_count)
    )
    if descriptors != EXPECTED_ZH_SECTION3_DESCRIPTORS:
        raise RadarMetadataError("BUFR descriptor structure is not the PAM ZH scan")
    offset += s3_length

    # Section 4 : marche bit à bit.
    s4_length = int.from_bytes(raw[offset : offset + 3])
    payload = raw[offset + 4 : offset + s4_length]
    if offset + s4_length != len(raw) - 4:
        raise RadarMetadataError("PAM BUFR section lengths are inconsistent")

    reader = BitReader(payload)

    # 321011 : en-tête image (type, combinaison, type de grille).
    reader.skip(W_030031 + W_030032 + W_029002)

    # 301011 + 301013 : horodatage du début du tour.
    observed = (
        _required(reader, W_YEAR, "004001"),
        _required(reader, W_MONTH, "004002"),
        _required(reader, W_DAY, "004003"),
        _required(reader, W_HOUR, "004004"),
        _required(reader, W_MINUTE, "004005"),
        _required(reader, W_SECOND, "004006"),
    )

    # 301001 + 301021 : identifiant OMM (ignoré) puis position station.
    reader.skip(W_001001 + W_001002)
    station_latitude = _scaled(_required(reader, W_005001, "005001"), S_005001, R_005001)
    station_longitude = _scaled(_required(reader, W_006001, "006001"), S_006001, R_006001)

    # Identité matérielle puis caractéristiques d'antenne (321010) : seule
    # l'altitude de l'antenne (007002) est extraite.
    reader.skip(W_002205 + W_002193 + W_025060)
    reader.skip(W_002101)
    antenna_altitude_m = _scaled(_required(reader, W_007002, "007002"), S_007002, R_007002)
    reader.skip(W_321010_TAIL)
    reader.skip(W_002106_MOD + W_002207 + W_025004 + W_002121_MOD)
    reader.skip(W_002122 + W_002123 + W_002124)

    # Réplication 105000 : fréquences de répétition d'impulsion.
    prf_count = reader.read(W_031001)
    reader.skip(prf_count * W_002125_MOD)
    reader.skip(W_002126 + W_002127 + W_002128 + W_002129_MOD + W_002130 + W_002131)

    azimuth_step_deg = _scaled(_required(reader, W_005196, "005196"), S_005196, 0)
    gate_length_integrated = _required(reader, W_055233, "055233")

    # Réplication 101000/031192 : niveau de bruit par radiale.
    noise_count = reader.read(W_031192)
    reader.skip(noise_count * W_025201)

    # 321006 : longueur de porte + intégration. Comparaison en entiers
    # (025001 est en décamètres : échelle -1) pour rester exacte.
    gate_length_raw = _required(reader, W_025001, "025001")
    reader.skip(W_025002 + W_025003 + W_025005)
    if gate_length_raw * 10 != gate_length_integrated:
        raise RadarMetadataError(
            f"inconsistent range-gate lengths: {gate_length_raw * 10} m (025001)"
            f" vs {gate_length_integrated} m (055233)"
        )
    gate_length_m = float(gate_length_integrated)

    # 321007 (corrections) + arrêt/panne + bloc étalonnage 321192.
    reader.skip(W_321007 + W_002136 + W_002198)
    reader.skip(W_002194 + W_YEAR + W_MONTH + W_DAY + W_301012)
    reader.skip(W_002195 + W_002196 + W_002197)
    calibration_count = reader.read(W_031001)
    reader.skip(calibration_count * (W_021217 + W_021218))
    reader.skip(W_002199 + W_002206)

    # 321196 : sites de traitement inhibés.
    site_count = reader.read(W_031001)
    reader.skip(site_count * (W_002135 + W_006194 + W_006195))

    # Géométrie de l'image polaire.
    reader.skip(W_005033 + W_006033)
    gate_count = _required(reader, W_030021, "030021")
    azimuth_count = _required(reader, W_030022, "030022")
    if noise_count != azimuth_count:
        raise RadarMetadataError(
            f"radial noise block does not match the radial count:"
            f" {noise_count}; expected {azimuth_count}"
        )
    reader.skip(W_029001 + W_030192 + W_008021 + W_004025 + W_004026 + W_049239)

    # 321193 : table code→dBZ. Contrat observé : rampe identité 0..N-1,
    # chaque code accompagné de deux bornes de réflectivité (ignorées ici,
    # la conversion runtime est verrouillée par la calibration T3).
    lut_count = reader.read(W_031002)
    if not 0 < lut_count < (1 << ZH_CODE_WIDTH):
        raise RadarMetadataError(f"unexpected pixel-value lookup size: {lut_count}")
    for index in range(lut_count):
        code = reader.read(ZH_CODE_WIDTH)
        if code != index:
            raise RadarMetadataError(
                f"pixel-value lookup is not the identity ramp:"
                f" code {code} at position {index}"
            )
        reader.skip(2 * W_021216)

    # Codes qualité + géométrie du tour + paramètres PVR.
    reader.skip(W_049193 + W_049194 + W_049195 + W_049211)
    elevation_deg = _scaled(_required(reader, W_007021, "007021"), S_007021, R_007021)
    azimuth_start_deg = _scaled(_required(reader, W_002134, "002134"), S_002134, 0)
    reader.skip(W_010007 + W_049220 + W_049221 + W_049222 + W_049223)

    # Bits de calage puis matrice principale (azimut-major).
    padding_count = reader.read(W_031001)
    reader.skip(padding_count * W_048192)

    matrix_count = reader.read(W_031192)
    if matrix_count != azimuth_count * gate_count:
        raise RadarMetadataError(
            f"reflectivity matrix does not match the scan geometry:"
            f" {matrix_count}; expected {azimuth_count} x {gate_count}"
        )
    codes = reader.read_array(matrix_count, ZH_CODE_WIDTH)
    valid = codes[codes != ZH_CODE_MISSING]
    if valid.size and int(valid.max()) >= lut_count:
        raise RadarMetadataError(
            f"reflectivity code {int(valid.max())} exceeds the lookup table"
            f" ({lut_count} entries)"
        )

    # Fin de section : alignement octet + éventuel octet de parité, à zéro.
    if reader.remaining >= 16 or (reader.remaining and reader.read(reader.remaining) != 0):
        raise RadarMetadataError("unexpected trailing data in BUFR section 4")

    return PolarScanZh(
        observed_at_utc=observed,
        station_latitude=station_latitude,
        station_longitude=station_longitude,
        antenna_altitude_m=antenna_altitude_m,
        elevation_deg=elevation_deg,
        azimuth_start_deg=azimuth_start_deg,
        azimuth_step_deg=azimuth_step_deg,
        azimuth_count=azimuth_count,
        gate_count=gate_count,
        gate_length_m=gate_length_m,
        codes=codes.astype(np.uint8).reshape(azimuth_count, gate_count),
    )
