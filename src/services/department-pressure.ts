// src/services/department-pressure.ts — pression par département (refonte v2 du panneau « Indice stabilité », 12/10/2026).
// Rattache à un département les éléments du fil « À traiter » (événements recoupés, situations, alertes) et les signaux
// officiels départementaux (vigilance météo, tronçons Vigicrues) ; niveau du département = le plus haut de ses éléments, sur
// l'échelle L1. Pur, sans DOM. Ne remplace pas computeISNR (stability-index.ts), qui alimente l'indice national v3.

import type { FloodSectionRef, MeteoAlert, NewsEvent } from '../types/index.ts';
import type { DepartementIndex } from './departement-lookup.ts';
import type { WorkBadge, WorkItem } from './work-queue.ts';
import type { ThemeId } from './themes.ts';
import { LEVEL_RANK, maxLevel, officialLevel, type VigilanceLevel } from './vigilance.ts';
import { overseasDepartmentAt } from '../config/geo.ts';

export type PressureSource = 'event' | 'situation' | 'meteo' | 'vigicrues';

export interface PressureElement {
  /** Clé de la fiche à ouvrir (« event:42 », « situation:… ») ; null pour un signal officiel (pas de fiche propre). */
  key: string | null;
  level: VigilanceLevel;
  title: string;
  theme: ThemeId;
  source: PressureSource;
  badge: WorkBadge;
}

export interface DepartmentPressure {
  code: string;
  name: string;
  /** Jaune, orange ou rouge : un département sans élément jaune ou plus n'est pas sous pression. */
  level: Exclude<VigilanceLevel, 'vert'>;
  /** Thème qui tire le niveau : celui de l'élément le plus grave, puis le plus représenté. */
  driver: ThemeId;
  /** Du plus grave au moins grave. */
  elements: PressureElement[];
  /** Un élément nouveau ou aggravé depuis la visite. */
  badge: WorkBadge;
}

export interface DepartmentPressureInput {
  items: readonly WorkItem[];
  meteo: readonly MeteoAlert[];
  floods: readonly FloodSectionRef[];
  departements: DepartementIndex | null;
  now: number;
}

/** Codes de département cités dans une zone de situation : « Nord (59) », « Dépt 05 », « Haute-Corse (2B) ». */
export function zoneDepartmentCodes(zone: string): string[] {
  const codes: string[] = [];
  for (const m of zone.matchAll(/\((\d{2,3}|2[AB])\)/g)) codes.push(m[1]);
  const dept = /^D[ée]pt\.? (\d{2,3}|2[AB])\b/.exec(zone);
  if (dept) codes.push(dept[1]);
  return codes;
}

/** Point au milieu du tracé d'un tronçon, pour le rattacher à un département. */
function sectionPoint(section: FloodSectionRef): readonly [number, number] | null {
  const lines = section.geometry.type === 'LineString' ? [section.geometry.coordinates] : section.geometry.coordinates;
  const longest = lines.reduce((best, line) => (line.length > best.length ? line : best), lines[0] ?? []);
  const mid = longest[Math.floor(longest.length / 2)];
  return mid && mid.length >= 2 ? [mid[0], mid[1]] : null;
}

function eventOf(item: WorkItem): NewsEvent | null {
  return item.ref.kind === 'event' ? item.ref.event : null;
}

export function departmentPressure(input: DepartmentPressureInput): DepartmentPressure[] {
  const { departements } = input;
  const byCode = new Map<string, { name: string; elements: PressureElement[] }>();
  const add = (code: string, name: string | null, element: PressureElement): void => {
    if (element.level === 'vert') return;
    const label = name ?? departements?.nameOf(code) ?? code;
    const entry = byCode.get(code) ?? { name: label, elements: [] };
    // Un élément ne compte qu'une fois par département (situation citant deux fois la même zone).
    if (element.key !== null && entry.elements.some((e) => e.key === element.key)) return;
    entry.elements.push(element);
    byCode.set(code, entry);
  };
  // Métropole par la géométrie des départements, outre-mer par son cadre (la géométrie n'y va pas).
  const at = (lon: number | null | undefined, lat: number | null | undefined): { code: string; nom: string } | null => {
    if (typeof lon !== 'number' || typeof lat !== 'number') return null;
    return departements?.at(lon, lat) ?? overseasDepartmentAt(lon, lat);
  };

  for (const item of input.items) {
    const element = { key: item.key, level: item.level, title: item.title, theme: item.theme, badge: item.badge };
    const event = eventOf(item);
    if (event) {
      // Événement à l'étranger ou sans lieu (sujet national) : aucun département.
      if (event.zone === 'etranger') continue;
      const dept = at(event.lon, event.lat);
      if (dept) add(dept.code, dept.nom, { ...element, source: 'event' });
      continue;
    }
    if (item.ref.kind !== 'situation' && item.ref.kind !== 'alert') continue; // signaux officiels nationaux, marchés
    const situation = item.ref.situation;
    const dept = at(situation.lon, situation.lat);
    const codes = dept ? [dept.code] : [...new Set(situation.affectedZones.flatMap(zoneDepartmentCodes))];
    for (const code of codes) add(code, dept?.code === code ? dept.nom : null, { ...element, source: 'situation' });
  }

  for (const alert of input.meteo) {
    if (alert.endDate && alert.endDate.getTime() < input.now) continue; // vigilance échue
    add(alert.departmentCode, alert.department, {
      key: null, level: officialLevel(alert.level), title: 'Vigilance météo', theme: 'environment', source: 'meteo', badge: null,
    });
  }
  for (const section of input.floods) {
    const point = sectionPoint(section);
    const dept = point ? at(point[0], point[1]) : null;
    if (!dept) continue;
    add(dept.code, dept.nom, {
      key: null, level: officialLevel(section.level), title: `Crue : ${section.name}`, theme: 'environment', source: 'vigicrues', badge: null,
    });
  }

  const out: DepartmentPressure[] = [];
  for (const [code, { name, elements }] of byCode) {
    const sorted = [...elements].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
    const level = maxLevel(sorted.map((e) => e.level));
    if (level === 'vert') continue;
    out.push({
      code, name, level, elements: sorted,
      driver: driverTheme(sorted),
      badge: sorted.some((e) => e.badge === 'aggrave') ? 'aggrave' : sorted.some((e) => e.badge === 'nouveau') ? 'nouveau' : null,
    });
  }
  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.elements.length - a.elements.length || a.name.localeCompare(b.name, 'fr'));
}

/** Thème de l'élément le plus grave ; à égalité, le plus représenté à ce niveau. */
function driverTheme(sorted: readonly PressureElement[]): ThemeId {
  const top = sorted[0].level;
  const counts = new Map<ThemeId, number>();
  for (const e of sorted) if (e.level === top) counts.set(e.theme, (counts.get(e.theme) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
