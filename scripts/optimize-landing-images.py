#!/usr/bin/env python3
"""Génère les variantes AVIF/WebP (1440w et 720w) des captures de la landing page.

Source  : assets-src/landing/*.png (originaux haute résolution, non déployés)
Sortie  : public/landing/*.avif + *.webp (servis par la landing, hors precache PWA)

Ré-exécutable : régénère systématiquement toutes les variantes à partir des PNG
sources. Ne dépend d'aucun paquet npm — uniquement de Pillow (déjà présent dans
l'environnement de dev) pour le redimensionnement et l'encodage AVIF/WebP.

Usage :
    python3 scripts/optimize-landing-images.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow est requis : pip3 install --no-cache-dir Pillow", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "assets-src" / "landing"
OUT_DIR = ROOT / "public" / "landing"

# Largeurs générées, correspondant aux breakpoints du <picture> de LandingPage.ts
WIDTHS = (1440, 720)

# Budgets de taille par format/largeur (octets). Sert de garde-fou : si dépassé,
# la qualité est réduite par paliers jusqu'à repasser sous le budget (ou qualité
# plancher atteinte, auquel cas un avertissement est affiché).
SIZE_BUDGETS = {
    ("webp", 1440): 250_000,
    ("webp", 720): 130_000,
    ("avif", 1440): 220_000,
    ("avif", 720): 110_000,
}

# Qualité de départ (haute, car ces captures de dashboard sombre compressent
# très bien) puis paliers de repli si le budget est dépassé.
WEBP_QUALITY_STEPS = (85, 80, 75, 70, 62, 55, 45)
AVIF_QUALITY_STEPS = (65, 60, 55, 50, 45, 38, 30)


def human(n: int) -> str:
    return f"{n / 1024:.1f} KB"


def encode_with_budget(
    im: Image.Image,
    out_path: Path,
    fmt: str,
    quality_steps: tuple[int, ...],
    budget: int,
) -> tuple[int, int]:
    """Encode `im` dans `out_path`, réduisant la qualité tant que le budget est dépassé.

    Retourne (taille finale en octets, qualité utilisée).
    """
    last_size = 0
    last_quality = quality_steps[-1]
    for quality in quality_steps:
        save_kwargs = {"quality": quality}
        if fmt == "webp":
            save_kwargs["method"] = 6
        elif fmt == "avif":
            save_kwargs["speed"] = 6
        im.save(out_path, format=fmt.upper(), **save_kwargs)
        size = out_path.stat().st_size
        last_size = size
        last_quality = quality
        if size <= budget:
            return size, quality
    print(
        f"    ATTENTION: {out_path.name} reste à {human(last_size)} "
        f"(> budget {human(budget)}) même à qualité {last_quality}",
        file=sys.stderr,
    )
    return last_size, last_quality


def process_image(src: Path) -> list[tuple[str, int, int, int]]:
    """Traite une image source pour toutes les largeurs/formats cibles.

    Retourne une liste de lignes de rapport (nom_fichier, largeur, hauteur, taille).
    """
    stem = src.stem
    rows: list[tuple[str, int, int, int]] = []
    with Image.open(src) as original:
        original = original.convert("RGB")
        src_w, src_h = original.size

        for target_w in WIDTHS:
            target_h = round(src_h * target_w / src_w)
            resized = original.resize((target_w, target_h), Image.LANCZOS)

            webp_path = OUT_DIR / f"{stem}-{target_w}w.webp"
            webp_size, _ = encode_with_budget(
                resized, webp_path, "webp", WEBP_QUALITY_STEPS, SIZE_BUDGETS[("webp", target_w)]
            )
            rows.append((webp_path.name, target_w, target_h, webp_size))

            avif_path = OUT_DIR / f"{stem}-{target_w}w.avif"
            avif_size, _ = encode_with_budget(
                resized, avif_path, "avif", AVIF_QUALITY_STEPS, SIZE_BUDGETS[("avif", target_w)]
            )
            rows.append((avif_path.name, target_w, target_h, avif_size))

    return rows


def main() -> None:
    if not SRC_DIR.is_dir():
        print(f"Répertoire source introuvable : {SRC_DIR}", file=sys.stderr)
        sys.exit(1)

    sources = sorted(SRC_DIR.glob("*.png"))
    if not sources:
        print(f"Aucun PNG trouvé dans {SRC_DIR}", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Sources : {len(sources)} PNG dans {SRC_DIR.relative_to(ROOT)}")
    print(f"Sortie  : {OUT_DIR.relative_to(ROOT)}\n")

    all_rows: list[tuple[str, int, int, int]] = []
    total_src_bytes = 0
    for src in sources:
        total_src_bytes += src.stat().st_size
        print(f"→ {src.name} ({src.stat().st_size / 1024 / 1024:.1f} MB source)")
        rows = process_image(src)
        for name, w, h, size in rows:
            print(f"    {name:<32} {w}x{h:<8} {human(size)}")
        all_rows.extend(rows)

    total_out_bytes = sum(r[3] for r in all_rows)
    print("\n--- Résumé ---")
    print(f"PNG sources (hors déploiement) : {total_src_bytes / 1024 / 1024:.1f} MB")
    print(f"Variantes générées ({len(all_rows)} fichiers) : {total_out_bytes / 1024:.0f} KB")
    print(
        f"Réduction : {(1 - total_out_bytes / total_src_bytes) * 100:.1f}% "
        f"vs. PNG sources"
    )


if __name__ == "__main__":
    main()
