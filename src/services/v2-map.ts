// src/services/v2-map.ts — ce que la carte de la v2 dessine (spec 2026-09-29 § 5). Pur : App.ts
// passe les données en cache, DeckGLMap dessine le résultat.

import type { NewsEvent } from '../types/index.ts';
import { eventDisplayLevel, levelHex, unconfirmedPeakLevel, type VigilanceLevel } from './vigilance.ts';
import { categoryTheme, inTheme, type ThemeId } from './themes.ts';
import { eventEnters } from './work-queue.ts';

export interface EventMapPoint {
  id: number;
  title: string;
  lon: number;
  lat: number;
  level: VigilanceLevel;
  /** Rayon en pixels : 1 source indépendante, 2 à 4, 5 et plus. */
  radius: 5 | 8 | 12;
  /** « À confirmer » (gravité signalée par une seule source) : anneau vide. */
  hollow: boolean;
  color: [number, number, number];
}

export function sourcesRadius(independentCount: number): EventMapPoint['radius'] {
  if (independentCount >= 5) return 12;
  if (independentCount >= 2) return 8;
  return 5;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Un point par événement de la liste « À traiter » (mêmes règles d'entrée : tout point de la carte
 * est une ligne du fil), localisé, hors étranger, du thème choisi.
 */
export function eventMapPoints(events: readonly NewsEvent[], theme: ThemeId): EventMapPoint[] {
  const out: EventMapPoint[] = [];
  for (const e of events) {
    if (e.lon === null || e.lat === null || e.zone === 'etranger' || !eventEnters(e)) continue;
    if (!inTheme(categoryTheme(e.category), theme)) continue;
    const level = eventDisplayLevel(e.severity, e.peakSeverity);
    out.push({
      id: e.id, title: e.title, lon: e.lon, lat: e.lat, level,
      radius: sourcesRadius(e.independentCount),
      hollow: unconfirmedPeakLevel(e.severity, e.peakSeverity) !== null,
      color: hexToRgb(levelHex(level)),
    });
  }
  return out;
}
