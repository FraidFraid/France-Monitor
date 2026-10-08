// src/components/layer-panel/urgences-legend.ts : retard (S2) et légende datée (S1) de la couche Urgences de la carte.
// Pur et hors de deckgl/ : App.ts le charge sans tirer les modules de la carte ni maplibre-gl ; deckgl/health-map.ts le réutilise.
import type { SyndromicResponse } from '../../types/index.ts';
import { epiWeekLabel, isHealthDataLate } from '../../services/health-levels.ts';
import type { LegendCategory } from '../MapLegend.ts';
import { parisDay } from './health-format.ts';

/**
 * S2 : urgences en retard quand la fin de la dernière semaine publiée + 17 jours est dépassée (même règle que le panneau) ;
 * sans semaine publiée, rien à dater.
 */
export function urgencesLate(syndromic: SyndromicResponse | null, now: number): boolean {
  const week = syndromic?.week;
  return week ? isHealthDataLate('syndromic', week.end, now) : false;
}

/**
 * Légende Urgences datée (S1) : semaine épidémiologique et date de publication ; en retard (S2), « (en retard) » et
 * couleurs de niveau retirées de la carte. Sans semaine publiée : la légende de base.
 */
export function urgencesLegend(base: LegendCategory, syndromic: SyndromicResponse | null, now: number): LegendCategory {
  const week = syndromic?.week;
  if (!syndromic || !week) return base;
  const published = syndromic.publishedAt ? `, publiées le ${parisDay(syndromic.publishedAt)}` : '';
  const period = `Données : ${epiWeekLabel(week)}${published}`;
  const line = urgencesLate(syndromic, now) ? `${period} (en retard) : couleurs de niveau retirées.` : `${period}.`;
  return { ...base, notes: [line, ...(base.notes ?? [])] };
}
