"""Two-dimensional radar raster rendering."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

from PIL import Image


PALETTE = (
    (-9.0, (94, 211, 255, 75)),
    (0.0, (57, 171, 255, 115)),
    (10.0, (34, 139, 230, 145)),
    (20.0, (38, 197, 106, 165)),
    (30.0, (245, 220, 66, 185)),
    (40.0, (247, 143, 45, 205)),
    (50.0, (231, 72, 72, 225)),
    (60.0, (174, 59, 196, 235)),
    (70.0, (255, 255, 255, 245)),
)


def _color(value: float | None) -> tuple[int, int, int, int]:
    if value is None or value == -40.0:
        return (0, 0, 0, 0)
    selected = PALETTE[0][1]
    for threshold, color in PALETTE:
        if value < threshold:
            break
        selected = color
    return selected


def render_reflectivity(
    reflectivity_values: Sequence[float | None],
    *,
    width: int,
    height: int,
    output: Path,
) -> None:
    if len(reflectivity_values) != width * height:
        raise ValueError("pixel count does not match raster dimensions")
    rgba = bytearray(width * height * 4)
    for index, value in enumerate(reflectivity_values):
        start = index * 4
        rgba[start : start + 4] = bytes(_color(value))
    image = Image.frombytes("RGBA", (width, height), bytes(rgba))
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="WEBP", lossless=True, method=4)
