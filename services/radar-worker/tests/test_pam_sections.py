"""Segmentation multi-messages du fichier PAM (BUFR édition 2)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from models import RadarMetadataError  # noqa: E402
from pam_bitstream import select_zh_message, split_messages  # noqa: E402

FIXTURE = os.environ.get("RADAR_PAM_FIXTURE", "")
requires_fixture = pytest.mark.skipif(
    not (FIXTURE and Path(FIXTURE).is_file()),
    reason="RADAR_PAM_FIXTURE absent : test sur produit réel réservé au dev",
)


def test_rejects_non_bufr_payload():
    with pytest.raises(RadarMetadataError):
        split_messages(b"GRIB123")


def test_rejects_truncated_message():
    # En-tête BUFR annonçant 100 octets mais flux tronqué.
    data = b"BUFR" + (100).to_bytes(3) + bytes([2]) + b"\x00" * 10
    with pytest.raises(RadarMetadataError):
        split_messages(data)


def test_rejects_wrong_edition():
    data = b"BUFR" + (12).to_bytes(3) + bytes([4]) + b"7777"
    with pytest.raises(RadarMetadataError):
        split_messages(data)


@requires_fixture
def test_fixture_carries_six_messages_with_known_subcategories():
    messages = split_messages(Path(FIXTURE).read_bytes())
    assert [m.data_subcategory for m in messages] == [0, 16, 15, 17, 10, 18]
    zh = select_zh_message(messages)
    assert zh.data_subcategory == 0
    assert zh.local_tables_version == 20
    assert zh.raw[:4] == b"BUFR" and zh.raw[-4:] == b"7777"
