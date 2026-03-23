"""
border_flows.py — Analyse des échanges d'électricité aux frontières françaises.

Source : ODRÉ éco2mix-national-tr (RTE, pas de 30 min)
  https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records

Convention des signes éco2mix (côté France) :
  > 0  → export depuis la France vers le pays voisin
  < 0  → import depuis le pays voisin vers la France

Usage :
  python border_flows.py              # 7 derniers jours
  python border_flows.py --days 14    # 14 derniers jours
  python border_flows.py --csv data.csv   # charger depuis un CSV local

Sorties dans ./output/ :
  fr_<id>_7d.png   graphique par frontière
  border_flows.csv  agrégat journalier toutes frontières
"""

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo  # Python 3.9+

import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import requests

# ── Configuration des frontières ──────────────────────────────────────────────

BORDERS: list[dict] = [
    {"id": "es",  "label": "Espagne",          "field": "ech_comm_espagne"},
    {"id": "it",  "label": "Italie",            "field": "ech_comm_italie"},
    {"id": "ch",  "label": "Suisse",            "field": "ech_comm_suisse"},
    {"id": "de",  "label": "All./Bel./Lux.",    "field": "ech_comm_allemagne_belgique"},
    {"id": "gb",  "label": "Royaume-Uni",       "field": "ech_comm_angleterre"},
]

# Colonnes à télécharger
FIELDS = ["date_heure"] + [b["field"] for b in BORDERS]

TZ_FR   = ZoneInfo("Europe/Paris")
TZ_UTC  = timezone.utc

ODRE_URL = (
    "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets"
    "/eco2mix-national-tr/records"
)
PAGE_SIZE = 100

# ── Téléchargement ─────────────────────────────────────────────────────────────

def fetch_odre(days: int = 7) -> pd.DataFrame:
    now   = datetime.now(TZ_UTC)
    start = now - timedelta(days=days)
    start_iso = start.strftime("%Y-%m-%dT%H:%M:%S")

    select_fields = ",".join(FIELDS)
    where_clause  = f'date_heure >= "{start_iso}" AND {BORDERS[0]["field"]} is not null'

    records: list[dict] = []
    offset = 0

    print(f"[fetch] Téléchargement des {days} derniers jours depuis ODRÉ…")

    while True:
        params = {
            "limit":    PAGE_SIZE,
            "offset":   offset,
            "select":   select_fields,
            "where":    where_clause,
            "order_by": "date_heure",
        }
        try:
            resp = requests.get(ODRE_URL, params=params, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            print(f"[ERREUR] Requête ODRÉ : {exc}", file=sys.stderr)
            sys.exit(1)

        data = resp.json()
        page = data.get("results", [])
        records.extend(page)

        total = data.get("total_count", len(records))
        print(f"  …{len(records)}/{total} enregistrements", end="\r")

        if len(page) < PAGE_SIZE or len(records) >= total:
            break
        offset += PAGE_SIZE

    print(f"\n[fetch] {len(records)} enregistrements reçus.")

    if not records:
        print("[ERREUR] Aucune donnée retournée.", file=sys.stderr)
        sys.exit(1)

    return pd.DataFrame(records)

# ── Nettoyage ─────────────────────────────────────────────────────────────────

def clean(df: pd.DataFrame) -> pd.DataFrame:
    # Parse date_heure (format "YYYY-MM-DD HH:mm:ss" ou ISO) → UTC → heure locale FR
    df["ts"] = (
        pd.to_datetime(df["date_heure"], utc=True, errors="coerce")
        .dt.tz_convert(TZ_FR)
    )
    df = df.dropna(subset=["ts"]).sort_values("ts").reset_index(drop=True)

    # Convertir les colonnes numériques
    for b in BORDERS:
        col = b["field"]
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df["date"] = df["ts"].dt.date
    return df

# ── Export CSV agrégat ─────────────────────────────────────────────────────────

def export_summary_csv(df: pd.DataFrame, out_dir: Path) -> None:
    rows = []
    for b in BORDERS:
        col = b["field"]
        if col not in df.columns:
            continue
        daily = (
            df.groupby("date")[col]
            .agg(
                mean_mw="mean",
                median_mw="median",
                export_h=lambda s: (s > 0).sum() * 0.5,   # 30-min steps → heures
                import_h=lambda s: (s < 0).sum() * 0.5,
                max_export=lambda s: s[s > 0].max() if (s > 0).any() else 0,
                max_import=lambda s: s[s < 0].min() if (s < 0).any() else 0,
            )
            .reset_index()
        )
        daily.insert(0, "border", b["label"])
        daily.insert(1, "border_id", b["id"])
        rows.append(daily)

    if not rows:
        print("[AVERT] Aucune donnée à exporter.")
        return

    summary = pd.concat(rows, ignore_index=True)
    csv_path = out_dir / "border_flows.csv"
    summary.to_csv(csv_path, index=False, float_format="%.1f")
    print(f"[csv] {csv_path}")

# ── Graphiques ─────────────────────────────────────────────────────────────────

COLOR_EXPORT = "#00C896"   # vert cyan
COLOR_IMPORT = "#FF4B4B"   # rouge
COLOR_ZERO   = "#444"

def plot_border(df: pd.DataFrame, border: dict, out_dir: Path, days: int) -> None:
    col = border["field"]
    if col not in df.columns or df[col].isna().all():
        print(f"[SKIP] {border['label']} — colonne absente ou vide.")
        return

    ts  = df["ts"]
    mw  = df[col]

    fig, axes = plt.subplots(
        2, 1,
        figsize=(12, 6),
        gridspec_kw={"height_ratios": [3, 1]},
        sharex=True,
    )
    fig.patch.set_facecolor("#0e1117")
    for ax in axes:
        ax.set_facecolor("#161b22")
        ax.tick_params(colors="#c9d1d9")
        ax.spines[:].set_color("#30363d")

    ax_main, ax_bar = axes

    # ── Ligne principale avec zones colorées ──────────────────────────────────
    ax_main.axhline(0, color=COLOR_ZERO, linewidth=0.8, linestyle="--", alpha=0.6)

    ax_main.fill_between(ts, mw, 0,
                         where=(mw >= 0), interpolate=True,
                         color=COLOR_EXPORT, alpha=0.25, label="Export FR")
    ax_main.fill_between(ts, mw, 0,
                         where=(mw < 0),  interpolate=True,
                         color=COLOR_IMPORT, alpha=0.25, label="Import FR")
    ax_main.plot(ts, mw, color="#e6edf3", linewidth=0.8, alpha=0.9)

    ax_main.set_ylabel("MW (côté France)", color="#8b949e", fontsize=10)
    ax_main.legend(loc="upper right", fontsize=9,
                   facecolor="#161b22", edgecolor="#30363d", labelcolor="#c9d1d9")
    ax_main.set_title(
        f"Échanges FR ↔ {border['label']} — {days} derniers jours",
        color="#e6edf3", fontsize=13, pad=10,
    )

    # Annotations min/max
    idx_max = mw.idxmax()
    idx_min = mw.idxmin()
    for idx, clr in [(idx_max, COLOR_EXPORT), (idx_min, COLOR_IMPORT)]:
        val = mw[idx]
        if abs(val) < 50:
            continue
        ax_main.annotate(
            f"{val:+.0f} MW",
            xy=(ts[idx], val),
            xytext=(0, 12 if val > 0 else -16),
            textcoords="offset points",
            fontsize=8, color=clr,
            arrowprops=dict(arrowstyle="-", color=clr, lw=0.8),
        )

    # ── Barres journalières (moyennes) ────────────────────────────────────────
    daily_mean = df.groupby("date")[col].mean()
    dates_num  = [mdates.date2num(d) for d in daily_mean.index]
    colors_bar = [COLOR_EXPORT if v >= 0 else COLOR_IMPORT for v in daily_mean]

    ax_bar.bar(dates_num, daily_mean.values,
               color=colors_bar, alpha=0.85, width=0.6)
    ax_bar.axhline(0, color=COLOR_ZERO, linewidth=0.6)
    ax_bar.set_ylabel("Moy. j. MW", color="#8b949e", fontsize=8)

    # ── Axe X ─────────────────────────────────────────────────────────────────
    ax_bar.xaxis_date(str(TZ_FR))
    ax_bar.xaxis.set_major_formatter(mdates.DateFormatter("%d/%m", tz=TZ_FR))
    ax_bar.xaxis.set_major_locator(mdates.DayLocator(tz=TZ_FR))
    fig.autofmt_xdate(rotation=0, ha="center")

    plt.tight_layout(h_pad=0.5)

    png_path = out_dir / f"fr_{border['id']}_{days}d.png"
    fig.savefig(png_path, dpi=150, bbox_inches="tight",
                facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"[png] {png_path}")

# ── Entrée principale ──────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Graphiques échanges électricité FR frontières")
    parser.add_argument("--days",  type=int,  default=7,    help="Nombre de jours (défaut : 7)")
    parser.add_argument("--csv",   type=str,  default=None, help="CSV local (colonnes éco2mix)")
    parser.add_argument("--out",   type=str,  default="output", help="Dossier de sortie")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── Chargement des données ─────────────────────────────────────────────────
    if args.csv:
        print(f"[load] Lecture depuis {args.csv}…")
        raw = pd.read_csv(args.csv, low_memory=False)
        # Normalise le nom de colonne date si besoin
        for candidate in ("date_heure", "Date - Heure", "datetime", "Datetime"):
            if candidate in raw.columns:
                raw = raw.rename(columns={candidate: "date_heure"})
                break
    else:
        raw = fetch_odre(days=args.days)

    df = clean(raw)
    print(f"[data] {len(df)} points | {df['ts'].min()} → {df['ts'].max()}")

    # ── Export CSV résumé ──────────────────────────────────────────────────────
    export_summary_csv(df, out_dir)

    # ── Graphiques par frontière ───────────────────────────────────────────────
    for border in BORDERS:
        plot_border(df, border, out_dir, days=args.days)

    print(f"\n✓ Terminé. Fichiers dans : {out_dir.resolve()}")


if __name__ == "__main__":
    main()
