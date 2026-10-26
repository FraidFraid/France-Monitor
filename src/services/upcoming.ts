// src/services/upcoming.ts : échéances annoncées par les sources (26/10/2026). France Monitor ne prévoit rien : il reprend ce que les
// émetteurs publient eux-mêmes pour les jours à venir, attribué et daté, sans le transformer en prévision (finalité : aide à la
// décision, jamais un outil de prédiction). Trois sources aujourd'hui :
//   - Écowatt (RTE) : signal de J+1 à J+3 ;
//   - vigilance Météo-France : carte de J+1, par département ;
//   - prévisions Vigicrues : hausse annoncée sur un tronçon en vigilance (pic, date et fourchette publiés) ;
//   - rassemblements annoncés (couche Manifestations : Démosphère, carte des gilets jaunes) sur 7 jours, jamais confirmés.
// Une source qui n'annonce rien le dit aussi (« aucune alerte annoncée ») : une absence d'annonce est une information, à condition
// d'être attribuée ; une source non lue n'écrit rien (jamais un calme inventé).
import type { EcowattResponse, FloodsResponse, ProtestItem, VigilanceResponse } from '../types/index.ts';
import { readForecast } from './flood-forecast.ts';
import { PHENOMENON_WORD } from './environment-levels.ts';
import type { VigilanceLevel } from './vigilance.ts';

const DAY_MS = 24 * 3_600_000;
export const PROTESTS_HORIZON_DAYS = 7;

export interface UpcomingItem {
  /** Jour concerné, heure de Paris, « AAAA-MM-JJ ». */
  day: string;
  /** Niveau publié par la source ; null : annonce sans niveau (rassemblements). */
  level: VigilanceLevel | null;
  title: string;
  /** Détail éventuel (départements, villes). */
  detail: string | null;
  source: string;
}

export interface UpcomingInput {
  ecowatt: EcowattResponse | null;
  vigilance: VigilanceResponse | null;
  protests: readonly ProtestItem[] | null;
  /** Tronçons Vigicrues en vigilance et leurs stations (prévisions publiées) ; absent ou null : non lus. */
  floods?: FloodsResponse | null;
  now: number;
}

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
export function parisDay(ms: number): string {
  return PARIS_DAY.format(new Date(ms));
}

function dayMonth(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

function names(list: readonly string[], max = 4): string {
  if (list.length <= max) return list.join(', ');
  const rest = list.length - max;
  return `${list.slice(0, max).join(', ')} et ${rest} autre${rest > 1 ? 's' : ''}`;
}

function ecowattItems(ecowatt: EcowattResponse | null, today: string): UpcomingItem[] {
  const official = ecowatt?.official;
  // Repli ODRÉ : jours passés seulement, jamais une annonce.
  if (!official || official.source !== 'rte') return [];
  const future = official.days.filter((d) => d.date > today);
  if (future.length === 0) return [];
  const alerts = future.filter((d) => d.level !== 'green');
  if (alerts.length === 0) {
    const last = future[future.length - 1].date;
    return [{ day: future[0].date, level: null, title: `Écowatt : aucune alerte annoncée jusqu'au ${dayMonth(last)}`, detail: null, source: 'RTE' }];
  }
  return alerts.map((d) => ({
    day: d.date,
    level: d.level === 'red' ? 'rouge' : 'orange',
    title: d.level === 'red' ? 'Écowatt rouge : coupures possibles si la consommation ne baisse pas' : 'Écowatt orange : système électrique tendu',
    detail: d.message || null,
    source: 'RTE',
  }));
}

const COLOR_LEVEL: Readonly<Record<number, VigilanceLevel>> = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };

function vigilanceItems(vigilance: VigilanceResponse | null): UpcomingItem[] {
  const period = vigilance?.periods.find((p) => p.echeance === 'J1');
  if (!period) return [];
  const day = parisDay(Date.parse(period.begin) + 12 * 3_600_000);
  const strong = period.departments.filter((d) => d.color >= 3);
  const yellow = period.departments.filter((d) => d.color === 2);
  const items: UpcomingItem[] = [];
  for (const color of [4, 3] as const) {
    const depts = strong.filter((d) => d.color === color);
    if (depts.length === 0) continue;
    const phenomena = [...new Set(depts.flatMap((d) => d.phenomena.filter((p) => p.color === color).map((p) => PHENOMENON_WORD[p.id])))];
    items.push({
      day,
      level: COLOR_LEVEL[color],
      title: `Vigilance ${COLOR_LEVEL[color]} ${phenomena.join(', ')} dans ${depts.length} département${depts.length > 1 ? 's' : ''}`,
      detail: names(depts.map((d) => `${d.name} (${d.code})`)),
      source: 'Météo-France',
    });
  }
  if (yellow.length > 0) {
    items.push({ day, level: 'jaune', title: `Vigilance jaune dans ${yellow.length} département${yellow.length > 1 ? 's' : ''}`, detail: null, source: 'Météo-France' });
  }
  if (items.length === 0) {
    items.push({ day, level: null, title: 'Météo-France : aucune vigilance jaune ou plus annoncée', detail: null, source: 'Météo-France' });
  }
  return items;
}

const FLOOD_LEVEL: Readonly<Record<number, VigilanceLevel>> = { 2: 'jaune', 3: 'orange', 4: 'rouge' };
const metres = (v: number): string => `${v.toFixed(2).replace('.', ',')}\u00a0m`;

/** Une échéance par tronçon en vigilance dont Vigicrues prévoit une hausse : la station au plus haut pic prévu. */
function floodItems(floods: FloodsResponse | null | undefined, now: number): UpcomingItem[] {
  if (!floods) return [];
  const items: UpcomingItem[] = [];
  for (const section of floods.sections) {
    const rising = section.stations
      .map((st) => ({ st, r: readForecast(st, now) }))
      .filter((x): x is { st: typeof x.st; r: NonNullable<typeof x.r> } => x.r !== null && x.r.trend === 'hausse')
      .sort((a, b) => b.r.key.mean - a.r.key.mean);
    const top = rising[0];
    if (!top) continue;
    const k = top.r.key;
    const range = k.min !== k.max ? `fourchette ${metres(k.min).replace('\u00a0m', '')} à ${metres(k.max)}` : null;
    items.push({
      day: parisDay(Date.parse(k.at)),
      level: FLOOD_LEVEL[section.level] ?? null,
      title: `Hausse annoncée : ${section.name} à ${top.st.name}, jusqu'à ${metres(k.mean)}`,
      detail: [range, rising.length > 1 ? `${rising.length} stations en hausse sur le tronçon` : null].filter(Boolean).join(' ; ') || null,
      source: 'Vigicrues',
    });
  }
  return items;
}

const PROTEST_SOURCE_LABEL: Readonly<Record<string, string>> = { demosphere: 'Démosphère', giletsjaunes: 'carte des gilets jaunes', prefecture: 'préfectures' };

function protestItems(protests: readonly ProtestItem[] | null, now: number, today: string): UpcomingItem[] {
  if (!protests) return [];
  const horizon = parisDay(now + PROTESTS_HORIZON_DAYS * DAY_MS);
  const byDay = new Map<string, ProtestItem[]>();
  for (const p of protests) {
    if (p.status !== 'annonce' || !p.startsAt) continue;
    const day = parisDay(Date.parse(p.startsAt));
    if (day <= today || day > horizon) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  return [...byDay.entries()].map(([day, list]) => {
    const cities = [...new Map(list.filter((p) => p.city).map((p) => [p.city as string, true])).keys()];
    const sources = [...new Set(list.map((p) => PROTEST_SOURCE_LABEL[p.source] ?? p.source))];
    return {
      day,
      level: null,
      title: `${list.length} rassemblement${list.length > 1 ? 's' : ''} annoncé${list.length > 1 ? 's' : ''}`,
      detail: cities.length > 0 ? `dont ${names(cities)} ; annonces publiques, non confirmées` : 'annonces publiques, non confirmées',
      source: sources.join(', '),
    };
  });
}

/** Échéances des jours à venir, par jour puis par gravité publiée. */
export function upcomingFromSources(input: UpcomingInput): UpcomingItem[] {
  const today = parisDay(input.now);
  const rank = (l: VigilanceLevel | null): number => (l === 'rouge' ? 0 : l === 'orange' ? 1 : l === 'jaune' ? 2 : 3);
  return [...ecowattItems(input.ecowatt, today), ...vigilanceItems(input.vigilance), ...floodItems(input.floods, input.now), ...protestItems(input.protests, input.now, today)]
    .sort((a, b) => a.day.localeCompare(b.day) || rank(a.level) - rank(b.level));
}
