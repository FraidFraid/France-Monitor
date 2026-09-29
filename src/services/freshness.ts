// src/services/freshness.ts — fraîcheur des données (spec 2026-09-29 § 8) : chaque donnée affichée
// porte sa propre date ; au-delà du délai de sa source elle est périmée (grisée, hors des listes
// « du moment »). Une donnée sans date est traitée comme périmée. Pur.

export type FreshnessSource =
  | 'meteo' | 'vigicrues' | 'ecowatt' | 'fuel' | 'sentinelles' | 'healthAlerts' | 'brief' | 'networkBarometer' | 'markets';

const H = 3_600_000;
const D = 24 * H;

export const FRESHNESS_MAX_AGE_MS: Record<FreshnessSource, number> = {
  meteo: 6 * H,
  vigicrues: 2 * H,
  ecowatt: 24 * H,
  fuel: 2 * D,
  sentinelles: 10 * D,
  healthAlerts: 14 * D,
  brief: 12 * H,
  networkBarometer: H,
  // « 1 jour ouvré » : 72 h couvrent le week-end (cours du vendredi lus le lundi matin).
  markets: 3 * D,
};

export type Freshness = 'fresh' | 'stale';

export function freshnessOf(dataAt: number | null, source: FreshnessSource, now: number): Freshness {
  if (dataAt === null || !Number.isFinite(dataAt)) return 'stale';
  return now - dataAt <= FRESHNESS_MAX_AGE_MS[source] ? 'fresh' : 'stale';
}

export function parseDataDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function partitionByFreshness<T>(
  items: readonly T[],
  dateOf: (item: T) => number | null,
  source: FreshnessSource,
  now: number,
): { current: T[]; older: T[] } {
  const current: T[] = [];
  const older: T[] = [];
  for (const item of items) (freshnessOf(dateOf(item), source, now) === 'fresh' ? current : older).push(item);
  return { current, older };
}

/** « données du 28/09 à 16:00 » (heure de Paris) ; « date inconnue ». */
export function dataDateLabel(dataAt: number | null, lang: 'fr' | 'en'): string {
  if (dataAt === null) return lang === 'fr' ? 'date inconnue' : 'unknown date';
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const d = new Date(dataAt);
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  return lang === 'fr' ? `données du ${date} à ${time}` : `data from ${date} at ${time}`;
}
