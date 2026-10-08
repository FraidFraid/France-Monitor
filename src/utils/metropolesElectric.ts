/**
 * metropolesElectric.ts — Classification visuelle des métropoles électriques.
 *
 * Centralise les seuils et paramètres visuels du layer :
 * - 3 classes de taille selon la part de la métropole par rapport au max (small / medium / large)
 * - Palette lisible faible / moyenne / forte
 * - Radius + opacity prêts à être injectés dans les propriétés GeoJSON → MapLibre
 */

import type { MetropoleConsumption } from '../services/metropoles.ts';
import { levelHex, type VigilanceLevel } from '../services/vigilance.ts';

// ── Types ──────────────────────────────────────────────────────────────────────

export type MetroleSizeClass = 'small' | 'medium' | 'large';

export interface MetropoleDisplayData {
  code: string;
  name: string;
  lon: number;
  lat: number;
  loadMW: number;
  date_heure: string;
  /** 0–1 — fraction du maximum observé dans le dataset courant */
  relativeLoad: number;
  sizeClass: MetroleSizeClass;
  /** Rayon du cercle principal en px (à injecter dans circle-radius via zoom interpolation) */
  circleRadius: number;
  /** Couleur RGBA du cercle principal (alpha inclus) */
  color: string;
  /** Couleur RGBA du halo de fond (alpha inclus) */
  glowColor: string;
  /** Consommation nationale (MW) à l'instant de la métropole ; undefined si indisponible */
  nationalMw?: number;
  /** Part dans la conso nationale (%) à ce même instant ; undefined si nationalMw manque */
  nationalSharePct?: number;
  /** Variation vs même heure J-1 (%) — undefined si non disponible */
  deltaVsJ1Pct?: number;
}

// ── Seuils & paramètres visuels ────────────────────────────────────────────────

// Seuils (fraction du max) — calibrés sur le jeu éCO2mix FR (Grand Paris toujours > 0.6)
const THRESHOLD_LARGE  = 0.6;
const THRESHOLD_MEDIUM = 0.2;

/** Classe de charge → niveau (spec lot 2 § 3.5) : faible vert, moyenne orange, forte rouge. */
export const METRO_LEVEL: Record<MetroleSizeClass, VigilanceLevel> = { small: 'vert', medium: 'orange', large: 'rouge' };
export const METRO_LEGEND_LABELS: Record<MetroleSizeClass, string> = {
  small: 'Charge relative faible', medium: 'Charge relative moyenne', large: 'Charge relative forte',
};

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Couleurs de la carte, dérivées des jetons de niveau (--sev-*) : MapLibre n'accepte pas var(). */
export const METROPOLE_COLORS: Record<MetroleSizeClass, { color: string; glowColor: string }> = {
  large: { color: rgba(levelHex(METRO_LEVEL.large), 0.82), glowColor: rgba(levelHex(METRO_LEVEL.large), 0.24) },
  medium: { color: rgba(levelHex(METRO_LEVEL.medium), 0.78), glowColor: rgba(levelHex(METRO_LEVEL.medium), 0.22) },
  small: { color: rgba(levelHex(METRO_LEVEL.small), 0.74), glowColor: rgba(levelHex(METRO_LEVEL.small), 0.2) },
};

const VISUAL: Record<MetroleSizeClass, { radius: number }> = {
  large:  { radius: 31 },
  medium: { radius: 21 },
  small:  { radius: 14 },
};

// ── Fonction principale ────────────────────────────────────────────────────────

/**
 * Classe un tableau de MetropoleConsumption et calcule les propriétés visuelles.
 *
 * @param data          - Données temps réel (depuis fetchMetropoles)
 */
export function classifyMetropoles(
  data: MetropoleConsumption[],
): MetropoleDisplayData[] {
  if (data.length === 0) return [];

  const maxLoad = Math.max(...data.map((m) => m.consommation), 1);

  return data.map((m) => {
    const relativeLoad = Math.min(m.consommation / maxLoad, 1);

    const sizeClass: MetroleSizeClass =
      relativeLoad > THRESHOLD_LARGE  ? 'large'  :
      relativeLoad > THRESHOLD_MEDIUM ? 'medium' :
      'small';

    const { radius: circleRadius } = VISUAL[sizeClass];
    const { color, glowColor } = METROPOLE_COLORS[sizeClass];

    // Part sur la consommation nationale au propre instant de la métropole ; sans valeur nationale à cet instant, pas de part.
    const nationalSharePct =
      m.nationalMw != null && m.nationalMw > 0
        ? Math.round((m.consommation / m.nationalMw) * 1000) / 10  // 1 décimale
        : undefined;

    return {
      code:            m.code,
      name:            m.name,
      lon:             m.lon,
      lat:             m.lat,
      loadMW:          m.consommation,
      date_heure:      m.date_heure,
      relativeLoad,
      sizeClass,
      circleRadius,
      color,
      glowColor,
      nationalMw:      m.nationalMw,
      nationalSharePct,
      deltaVsJ1Pct: m.deltaVsJ1Pct,
    };
  });
}
