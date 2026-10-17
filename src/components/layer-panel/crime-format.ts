// src/components/layer-panel/crime-format.ts : formatage des valeurs de la couche Criminalité (spec 2026-10-17 criminalité), partagé par
// le panneau et la carte ; fonctions pures. Nombre et unité jamais séparés (espace insécable) ; valeur absente : « n.d. ».
import type { CrimeIndicator, CrimeIndicatorKey } from '../../types/index.ts';
import { evolutionPct, ratePer100k, type CrimeReading } from '../../services/crime.ts';
import { NBSP, frNumber } from './format.ts';

const ND = 'n.d.';

/** Décimales d'un taux : trois sous 0,1, deux sous 1, une au-delà (jamais « 0,0 »). */
function rateDigits(v: number): number {
  return v < 0.1 ? 3 : v < 1 ? 2 : 1;
}

export function formatCrimeCount(n: number | null): string {
  return n === null ? ND : frNumber(n, 0);
}

/** Taux d'un indicateur : « 2,7 pour 100 000 hab. » (homicides), « 3,4 ‰ » (autres), tout insécable. */
export function formatCrimeRate(key: CrimeIndicatorKey, ratePerThousand: number | null): string {
  if (ratePerThousand === null) return ND;
  if (key === 'homicides') {
    const v = ratePer100k(ratePerThousand) ?? 0;
    return `${frNumber(v, 1)}${NBSP}pour${NBSP}100${NBSP}000${NBSP}hab.`;
  }
  return `${frNumber(ratePerThousand, rateDigits(ratePerThousand))}${NBSP}‰`;
}

/** Taux court pour les listes : « 2,7 » pour 100 000 (homicides) ou « 3,4 ‰ ». */
export function formatCrimeRateShort(key: CrimeIndicatorKey, ratePerThousand: number | null): string {
  if (ratePerThousand === null) return ND;
  if (key === 'homicides') return `${frNumber(ratePer100k(ratePerThousand) ?? 0, 1)}${NBSP}p.${NBSP}100${NBSP}000`;
  return formatCrimeRate(key, ratePerThousand);
}

/** « +12 % » avec le signe typographique ; n.d. si l'évolution n'est pas calculable. */
export function formatEvolution(count: number | null, previous: number | null): string {
  const pct = evolutionPct(count, previous);
  return pct === null ? ND : `${frNumber(pct, 0, true)}${NBSP}%`;
}

/** Mention du dénominateur du taux pour mille. */
export function rateBaseWord(ind: Pick<CrimeIndicator, 'key' | 'base'> | undefined): string {
  if (ind?.key === 'homicides') return 'pour 100 000 habitants';
  return ind?.base === 'logements' ? 'pour mille logements' : 'pour mille habitants';
}

/** Fragment de note : « 11 095 faits · +12 % vs 2024 », ou « estimé » quand le nombre est masqué par le secret statistique. */
export function readingNote(r: CrimeReading, previousYear: number | null): string {
  const parts: string[] = [];
  if (r.estimated) parts.push('estimé');
  else if (r.count !== null) parts.push(`${frNumber(r.count, 0)}${NBSP}${r.count > 1 ? 'faits' : 'fait'}`);
  else parts.push('nombre n.d.');
  if (!r.estimated && previousYear !== null && evolutionPct(r.count, r.previous) !== null) {
    parts.push(`${formatEvolution(r.count, r.previous)}${NBSP}vs${NBSP}${previousYear}`);
  }
  return parts.join(' · ');
}
