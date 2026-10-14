// src/services/v2-map.ts — ce que la carte de la v2 dessine (spec 2026-09-29 § 5). Pur : App.ts
// passe les données en cache, DeckGLMap dessine le résultat.

import type { NewsEvent, NewsItem, ThreatLevel } from '../types/index.ts';
import type { IconName } from '../components/shared/icons.ts';
import { eventDisplayLevel, eventLevel, LEVEL_RANK, levelHex, unconfirmedPeakLevel, type VigilanceLevel } from './vigilance.ts';
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
  /** Catégorie de l'événement (picto des alertes). */
  category: string;
  /** Orange ou rouge : agrandi, picto et étiquette (spec 2026-10-14). */
  alert: boolean;
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
export function eventMapPoints(
  events: readonly NewsEvent[],
  theme: ThemeId,
  hiddenLevels: ReadonlySet<VigilanceLevel> = new Set(),
): EventMapPoint[] {
  const out: EventMapPoint[] = [];
  for (const e of events) {
    if (e.lon === null || e.lat === null || e.zone === 'etranger' || !eventEnters(e)) continue;
    if (!inTheme(categoryTheme(e.category), theme)) continue;
    const level = eventDisplayLevel(e.severity, e.peakSeverity);
    if (hiddenLevels.has(level)) continue;
    out.push({
      id: e.id, title: e.title, lon: e.lon, lat: e.lat, level,
      radius: sourcesRadius(e.independentCount),
      hollow: unconfirmedPeakLevel(e.severity, e.peakSeverity) !== null,
      color: hexToRgb(levelHex(level)),
      category: e.category,
      alert: LEVEL_RANK[level] >= LEVEL_RANK.orange,
    });
  }
  return out;
}

/** Rayon dessiné : les alertes gagnent 5 px pour loger leur picto. */
export function drawnRadius(p: Pick<EventMapPoint, 'radius' | 'alert'>): number {
  return p.alert ? p.radius + 5 : p.radius;
}

/** Plus de doublon : un article d'un événement dessiné est dans l'aperçu de l'événement, pas sur la carte. */
export function newsOffDrawnEvents(items: readonly NewsItem[], drawnEventIds: ReadonlySet<number>): NewsItem[] {
  if (drawnEventIds.size === 0) return [...items];
  return items.filter((i) => i.eventId === undefined || !drawnEventIds.has(i.eventId));
}

/** Titre court d'étiquette : coupé au dernier mot qui tient, points de suspension. */
export function alertLabel(title: string, max = 40): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const head = space > max / 2 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.·-]+$/, '')}…`;
}

const CATEGORY_ICON: Readonly<Record<string, IconName>> = {
  security: 'shield', social: 'megaphone', energy: 'zap', weather: 'cloud-lightning', floods: 'waves', fires: 'flame',
  transport: 'train-front', infrastructure: 'factory', health: 'stethoscope', finance: 'trending-down', cyber: 'lock-keyhole',
  general: 'newspaper',
};
const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  security: 'Sécurité', social: 'Social', energy: 'Énergie', weather: 'Météo', floods: 'Crues', fires: 'Feux',
  transport: 'Transports', infrastructure: 'Infrastructures', health: 'Santé', finance: 'Finance', cyber: 'Cyber',
  general: 'Général',
};

export function categoryIcon(category: string): IconName {
  return CATEGORY_ICON[category] ?? 'newspaper';
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? 'Général';
}

export interface LabelBox { id: number; x: number; y: number; w: number; h: number }

/** Étiquettes placées dans l'ordre donné (priorité décroissante) ; une étiquette qui en chevauche une placée est omise. */
export function layoutAlertLabels(boxes: readonly LabelBox[]): Set<number> {
  const placed: LabelBox[] = [];
  const kept = new Set<number>();
  for (const b of boxes) {
    const hit = placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
    if (!hit) {
      placed.push(b);
      kept.add(b.id);
    }
  }
  return kept;
}

/** Le plus grave d'abord, puis le plus corroboré, puis l'identifiant (ordre stable). */
export function alertPriority(a: EventMapPoint, b: EventMapPoint): number {
  return LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.radius - a.radius || a.id - b.id;
}

/** Bleu des articles « information » (aucun niveau de vigilance). */
export const NEWS_INFO_HEX = '#5ac8fa';

/** Couleur d'un article : celle du niveau de vigilance correspondant, bleu pour l'information. */
export function newsLevelHex(level: ThreatLevel): string {
  return level === 'info' ? NEWS_INFO_HEX : levelHex(eventLevel(level));
}
