"""Lecture directe du train de bits des messages PAM (BUFR édition 2).

Un fichier PAM = un tour d'antenne = 6 messages BUFR concaténés, un par
paramètre. Seul le message ZH (dataSubCategory 0) est décodé ; les autres
sont ignorés. Même philosophie que bufr_bitstream (IMFR27) : toute
déviation du contrat observé lève RadarMetadataError, eccodes reste
l'oracle des tests différentiels et n'entre jamais dans le runtime.
"""
from __future__ import annotations

from dataclasses import dataclass

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
