"""Lecture directe du train de bits BUFR du produit IMFR27 (mosaïque 1 km).

eccodes matérialise un accesseur C par élément expansé : ~4,7 millions pour
les 2,36 M de pixels de ce produit, soit plus de 16 Go de RAM. Ce module lit
la section 4 bit à bit selon la séquence de descripteurs du produit —
verrouillée par comparaison STRICTE de la section 3 — et reste sous quelques
centaines de Mo. eccodes reste l'oracle des tests différentiels.

Toute déviation du flux attendu (descripteurs, largeurs, valeurs de
référence, comptes de réplication) lève RadarMetadataError : si Météo-France
change le produit, on refuse de décoder plutôt que de deviner.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from models import RadarMetadataError

# Séquence exacte de la section 3 du produit IMFR27_C_LFPW (56 descripteurs).
EXPECTED_SECTION3_DESCRIPTORS: tuple[str, ...] = (
    "001099", "030031", "001192", "301011", "301013", "008021", "004025",
    "004026", "029002", "029001", "030021", "030022", "005033", "006033",
    "329192", "029192", "025194", "030032", "025192", "025009", "025010",
    "025011", "110000", "031001", "301001", "301011", "301013", "005001",
    "006001", "006196", "025210", "101000", "031001", "048192", "101000",
    "031001", "048192", "101000", "031192", "021120", "103000", "031192",
    "201124", "010002", "201000", "203011", "021001", "203255", "105000",
    "031192", "201132", "202129", "021001", "202000", "201000", "203000",
)

# Largeurs/échelles/références utilisées par la marche (tables WMO 16 et
# locales Météo-France 14/85 — vérifiées par test contre eccodes-definitions).
W_001099 = 248   # uniqueProductDefinition, CCITT IA5
W_030031 = 4     # pictureType
W_001192 = 8     # indicateur des composites (local)
W_YEAR, W_MONTH, W_DAY = 12, 4, 6          # 301011
W_HOUR, W_MINUTE, W_SECOND = 5, 6, 6       # 301013
W_008021 = 5     # timeSignificance
W_004025 = 12    # timePeriod (minutes)
W_004026 = 13    # timePeriod (secondes)
W_029002 = 3     # coordinateGridType
W_029001 = 3     # projectionType
W_030021 = 12    # numberOfPixelsPerRow
W_030022 = 12    # numberOfPixelsPerColumn
W_005033 = 16    # pixelSizeOnHorizontal1, échelle -1
W_006033 = 16    # pixelSizeOnHorizontal2, échelle -1
W_005001, S_005001, R_005001 = 25, 5, -9000000   # latitude (haute précision)
W_006001, S_006001, R_006001 = 26, 5, -18000000  # longitude
W_006198, S_006198, R_006198 = 26, 5, -18000000  # méridien parallèle à Y (local)
W_005194 = 8     # indicateur du centre de projection (local)
W_030192 = 8     # mode de balayage (local)
W_005195, S_005195, R_005195 = 25, 5, -9000000   # latitude de référence (local)
W_029192 = 6     # système géodésique (local)
W_025194 = 16    # numéro de version de composite (local)
W_030032 = 16    # combinationWithOtherData
W_025192 = 8     # méthode de composition (local)
W_025009 = 4     # calibrationMethod
W_025010 = 4     # clutterTreatment
W_025011 = 2     # groundOccultationCorrectionScreening
W_031001 = 8     # delayedDescriptorReplicationFactor
W_001001 = 7     # blockNumber
W_001002 = 10    # stationNumber
W_006196 = 16    # distance oblique maximale (local)
W_025210 = 10    # facteur de correction global (local)
W_048192 = 1     # bit de calage (local)
W_031192 = 32    # facteur super élargi de répétition (local)
W_021120 = 10    # radar data qualifier (probabilité de pluie)
W_010002_BASE = 16   # nonCoordinateHeight ; opérateur 201124 => 12 bits
W_021001_BASE = 7    # horizontalReflectivity ; opérateur 201132 => 11 bits
W_REFCHANGE = 11     # 203011 : nouvelles valeurs de référence sur 11 bits

EXPECTED_REFLECTIVITY_REFERENCE = -400  # écrite par le bloc 203011
REFLECTIVITY_WIDTH = W_021001_BASE + 4  # 201132
REFLECTIVITY_SCALE = 1                  # 202129
HEIGHT_WIDTH = W_010002_BASE - 4        # 201124


@dataclass(frozen=True)
class Imfr27Message:
    """Contenu extrait du BUFR, avant projection et validation métier."""

    observed_at_utc: tuple[int, int, int, int, int, int]
    descriptors: dict[str, Any]
    origin_lat: float
    origin_lon: float
    reflectivity_codes: np.ndarray  # uint16, 2047 = manquant


class _BitReader:
    def __init__(self, payload: bytes) -> None:
        self._bits = np.unpackbits(np.frombuffer(payload, dtype=np.uint8))
        self._pos = 0

    @property
    def position(self) -> int:
        return self._pos

    @property
    def remaining(self) -> int:
        return int(self._bits.size - self._pos)

    def read(self, width: int) -> int:
        if width > self.remaining:
            raise RadarMetadataError("BUFR data section ended prematurely")
        chunk = self._bits[self._pos : self._pos + width]
        self._pos += width
        value = 0
        for bit in chunk:
            value = (value << 1) | int(bit)
        return value

    def skip(self, width: int) -> None:
        if width > self.remaining:
            raise RadarMetadataError("BUFR data section ended prematurely")
        self._pos += width

    def read_array(self, count: int, width: int) -> np.ndarray:
        total = count * width
        if total > self.remaining:
            raise RadarMetadataError("BUFR data section ended prematurely")
        chunk = self._bits[self._pos : self._pos + total]
        self._pos += total
        weights = (1 << np.arange(width - 1, -1, -1)).astype(np.int64)
        return chunk.reshape(count, width).astype(np.int64) @ weights


def _descriptor_code(raw: int) -> str:
    return f"{raw >> 14}{(raw >> 8) & 0x3F:02d}{raw & 0xFF:03d}"


def _scaled(raw: int, scale: int, reference: int) -> float:
    return (raw + reference) / (10 ** scale)


def parse_imfr27(data: bytes) -> Imfr27Message:
    """Analyse stricte des sections 0/1/3/4 du BUFR IMFR27."""

    if len(data) < 8 or data[:4] != b"BUFR":
        raise RadarMetadataError("radar payload must start with a raw BUFR message")
    total_length = int.from_bytes(data[4:7])
    if total_length != len(data) or data[7] != 4:
        raise RadarMetadataError("radar BUFR must be a complete edition 4 message")
    if data[-4:] != b"7777":
        raise RadarMetadataError("radar BUFR is truncated (missing 7777 terminator)")

    offset = 8
    s1_length = int.from_bytes(data[offset : offset + 3])
    if s1_length < 22:
        raise RadarMetadataError("radar BUFR section 1 is too short")
    centre = int.from_bytes(data[offset + 4 : offset + 6])
    optional_section = data[offset + 9]
    category = data[offset + 10]
    local_subcategory = data[offset + 12]
    master_version = data[offset + 13]
    local_version = data[offset + 14]
    expectations = {
        "bufrHeaderCentre": (centre, 85),
        "masterTablesVersionNumber": (master_version, 16),
        "localTablesVersionNumber": (local_version, 14),
        "dataCategory": (category, 6),
        "dataSubCategory": (local_subcategory, 27),
    }
    for key, (actual, expected) in expectations.items():
        if actual != expected:
            raise RadarMetadataError(f"unexpected BUFR {key}: {actual}; expected {expected}")
    if optional_section & 0x80:
        raise RadarMetadataError("unexpected optional BUFR section 2 in radar product")
    offset += s1_length

    s3_length = int.from_bytes(data[offset : offset + 3])
    subsets = int.from_bytes(data[offset + 4 : offset + 6])
    s3_flags = data[offset + 6]
    if subsets != 1:
        raise RadarMetadataError(f"unexpected BUFR numberOfSubsets: {subsets}; expected 1")
    if s3_flags != 0b1000_0000:
        raise RadarMetadataError("radar BUFR must be observed and uncompressed")
    descriptor_count = (s3_length - 7) // 2
    descriptors = tuple(
        _descriptor_code(int.from_bytes(data[offset + 7 + 2 * i : offset + 9 + 2 * i]))
        for i in range(descriptor_count)
    )
    if descriptors != EXPECTED_SECTION3_DESCRIPTORS:
        raise RadarMetadataError("BUFR descriptor structure is not the IMFR27 mosaic")
    offset += s3_length

    s4_length = int.from_bytes(data[offset : offset + 3])
    payload = data[offset + 4 : offset + s4_length]
    if offset + s4_length != len(data) - 4:
        raise RadarMetadataError("radar BUFR section lengths are inconsistent")

    reader = _BitReader(payload)
    reader.skip(W_001099 + W_030031 + W_001192)

    observed = (
        reader.read(W_YEAR), reader.read(W_MONTH), reader.read(W_DAY),
        reader.read(W_HOUR), reader.read(W_MINUTE), reader.read(W_SECOND),
    )
    reader.skip(W_008021 + W_004025 + W_004026 + W_029002)

    projection_type = reader.read(W_029001)
    pixels_per_row = reader.read(W_030021)
    pixels_per_column = reader.read(W_030022)
    pixel_size_1 = _scaled(reader.read(W_005033), -1, 0)
    pixel_size_2 = _scaled(reader.read(W_006033), -1, 0)

    # Séquence locale 329192 : [005001, 006001, 006198, 005194, 030192, 005195]
    origin_lat = _scaled(reader.read(W_005001), S_005001, R_005001)
    origin_lon = _scaled(reader.read(W_006001), S_006001, R_006001)
    central_meridian = _scaled(reader.read(W_006198), S_006198, R_006198)
    projection_centre = reader.read(W_005194)
    scanning_mode = reader.read(W_030192)
    reference_latitude = _scaled(reader.read(W_005195), S_005195, R_005195)

    geodetic_system = reader.read(W_029192)
    reader.skip(W_025194 + W_030032 + W_025192 + W_025009 + W_025010 + W_025011)

    # Réplication 110000 : blocs stations, avec bits de calage internes.
    station_count = reader.read(W_031001)
    for _ in range(station_count):
        reader.skip(
            W_001001 + W_001002
            + W_YEAR + W_MONTH + W_DAY + W_HOUR + W_MINUTE + W_SECOND
            + W_005001 + W_006001 + W_006196 + W_025210
        )
        reader.skip(reader.read(W_031001) * W_048192)
    reader.skip(reader.read(W_031001) * W_048192)  # calage final

    pixel_count = pixels_per_row * pixels_per_column

    rain_count = reader.read(W_031192)
    if rain_count != pixel_count:
        raise RadarMetadataError("rain-probability raster does not match the grid size")
    reader.skip(rain_count * W_021120)

    height_count = reader.read(W_031192)
    if height_count != pixel_count:
        raise RadarMetadataError("echo-top raster does not match the grid size")
    reader.skip(height_count * HEIGHT_WIDTH)

    # Bloc 203011/203255 : nouvelle valeur de référence de 021001 sur 11 bits,
    # bit de poids fort = signe négatif.
    raw_reference = reader.read(W_REFCHANGE)
    sign_bit = 1 << (W_REFCHANGE - 1)
    reference = -(raw_reference & (sign_bit - 1)) if raw_reference & sign_bit else raw_reference
    if reference != EXPECTED_REFLECTIVITY_REFERENCE:
        raise RadarMetadataError(
            f"unexpected reflectivity reference value: {reference};"
            f" expected {EXPECTED_REFLECTIVITY_REFERENCE}"
        )

    reflectivity_count = reader.read(W_031192)
    if reflectivity_count != pixel_count:
        raise RadarMetadataError("reflectivity raster does not match the grid size")
    codes = reader.read_array(reflectivity_count, REFLECTIVITY_WIDTH)

    # Fin de section : alignement octet + éventuel octet de parité, à zéro.
    if reader.remaining >= 16 or (reader.remaining and reader.read(reader.remaining) != 0):
        raise RadarMetadataError("unexpected trailing data in BUFR section 4")

    return Imfr27Message(
        observed_at_utc=observed,
        descriptors={
            "029001": projection_type,
            "029192": geodetic_system,
            "030021": pixels_per_row,
            "030022": pixels_per_column,
            "005033": pixel_size_1,
            "006033": pixel_size_2,
            "005194": projection_centre,
            "005195": reference_latitude,
            "006198": central_meridian,
            "030192": scanning_mode,
            "005001": origin_lat,
            "006001": origin_lon,
        },
        origin_lat=origin_lat,
        origin_lon=origin_lon,
        reflectivity_codes=codes.astype(np.uint16),
    )


def reflectivity_values(codes: np.ndarray) -> list[float | None]:
    """Codes bruts 11 bits -> dBZ, avec la même rigueur que le chemin eccodes."""

    missing = codes == (1 << REFLECTIVITY_WIDTH) - 1
    scaled = (codes.astype(np.float64) + EXPECTED_REFLECTIVITY_REFERENCE) / (
        10 ** REFLECTIVITY_SCALE
    )
    valid = missing | (scaled == -40.0) | ((scaled >= -9.0) & (scaled <= 70.0))
    if not bool(valid.all()):
        bad = scaled[~valid][0]
        raise RadarMetadataError(f"unsupported horizontal reflectivity value: {bad}")
    values: list[float | None] = scaled.tolist()
    for index in np.flatnonzero(missing):
        values[index] = None
    return values
