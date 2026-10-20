// src/services/flood-forecast.ts : lecture d'une prévision de hauteur Vigicrues (lot 3 de l'onglet Environnement, 20/10/2026).
// Pur. Tendance d'après la moyenne prévue comparée à la dernière mesure : hausse ou baisse au-delà de 5 cm, sinon stable. Le pic
// est la plus haute moyenne prévue, avec sa fourchette. Aucune valeur au-delà de ce que Vigicrues publie.
import type { FloodForecast, FloodStation } from '../types/index.ts';

/** Écart de hauteur en dessous duquel la prévision est dite stable (m). */
export const FORECAST_TREND_M = 0.05;

export type ForecastTrend = 'hausse' | 'baisse' | 'stable';

export interface ForecastReading {
  trend: ForecastTrend;
  /** Point de plus haute moyenne prévue (hausse) ou dernier point (baisse, stable). */
  key: FloodForecast['points'][number];
  /** Heures entre maintenant et le point clé (arrondi, au moins 0). */
  inHours: number;
}

/** Un point prévu de plus de 15 min dans le passé n'est plus une prévision (Anduze le 20/10 : seul point déjà passé). */
const PAST_TOLERANCE_MS = 15 * 60_000;

export function readForecast(st: FloodStation, now: number): ForecastReading | null {
  const points = (st.forecast?.points ?? []).filter((p) => Date.parse(p.at) >= now - PAST_TOLERANCE_MS);
  if (points.length === 0) return null;
  const peak = points.reduce((m, p) => (p.mean > m.mean ? p : m));
  const last = points[points.length - 1];
  const ref = st.heightM ?? points[0].mean;
  const trend: ForecastTrend = peak.mean - ref > FORECAST_TREND_M ? 'hausse' : ref - last.mean > FORECAST_TREND_M ? 'baisse' : 'stable';
  const key = trend === 'hausse' ? peak : last;
  return { trend, key, inHours: Math.max(0, Math.round((Date.parse(key.at) - now) / 3_600_000)) };
}

const m = (v: number): string => `${v.toFixed(2).replace('.', ',')}\u00a0m`;
const hours = (h: number): string => (h <= 0 ? 'maintenant' : `dans ${h}\u00a0h`);

/** « Prévision Vigicrues : hausse, 2,40 m dans 4 h (2,10 à 2,70) » ; null sans prévision. */
export function forecastText(st: FloodStation, now: number): string | null {
  const r = readForecast(st, now);
  if (!r) return null;
  const range = r.key.min !== r.key.max ? ` (${m(r.key.min).replace('\u00a0m', '')} à ${m(r.key.max)})` : '';
  const word = r.trend === 'hausse' ? 'hausse jusqu’à' : r.trend === 'baisse' ? 'baisse vers' : 'stable autour de';
  return `Prévision Vigicrues : ${word} ${m(r.key.mean)} ${hours(r.inHours)}${range}`;
}
