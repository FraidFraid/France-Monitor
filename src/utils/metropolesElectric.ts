/**
 * metropolesElectric.ts — Classification visuelle des métropoles électriques.
 *
 * Centralise les seuils et paramètres visuels du layer :
 * - 3 classes de taille selon la part de la métropole par rapport au max (small / medium / large)
 * - Palette lisible faible / moyenne / forte
 * - Radius + opacity prêts à être injectés dans les propriétés GeoJSON → MapLibre
 */

import type { MetropoleConsumption } from '../services/metropoles.ts';

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
  /** Part dans la conso nationale (%) — undefined si nationalLoadMW non fourni */
  nationalSharePct?: number;
  /** Variation vs même heure J-1 (%) — undefined si non disponible */
  deltaVsJ1Pct?: number;
}

// ── Seuils & paramètres visuels ────────────────────────────────────────────────

// Seuils (fraction du max) — calibrés sur le jeu éCO2mix FR (Grand Paris toujours > 0.6)
const THRESHOLD_LARGE  = 0.6;
const THRESHOLD_MEDIUM = 0.2;

/**
 * Couleurs RGBA par classe — alpha encodé dans la chaîne couleur.
 */
export const METROPOLE_COLORS: Record<MetroleSizeClass, { color: string; glowColor: string }> = {
  large:  { color: 'rgba(255,59,48,0.82)',  glowColor: 'rgba(255,59,48,0.24)' },
  medium: { color: 'rgba(255,149,0,0.78)',  glowColor: 'rgba(255,149,0,0.22)' },
  small:  { color: 'rgba(52,199,89,0.74)',  glowColor: 'rgba(52,199,89,0.20)' },
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
 * @param nationalLoadMW - Conso totale nationale en MW (EnergyMix.total) — optionnel
 */
export function classifyMetropoles(
  data: MetropoleConsumption[],
  nationalLoadMW?: number,
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

    const nationalSharePct =
      nationalLoadMW != null && nationalLoadMW > 0
        ? Math.round((m.consommation / nationalLoadMW) * 1000) / 10  // 1 décimale
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
      nationalSharePct,
      deltaVsJ1Pct: m.deltaVsJ1Pct,
    };
  });
}
