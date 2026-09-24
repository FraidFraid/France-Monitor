// src/services/work-queue.ts — liste « À traiter » de la disposition A1 (refonte UI, spec §7).
// Pur (aucun DOM, aucun réseau) : App.ts fournit les données déjà en cache ; ce module décide ce
// qui entre dans la liste, à quel niveau L1, sous quel thème et avec quel badge depuis la visite.
// Rien de vert n'entre.

import {
  RISK_LABELS,
  type CommodityData,
  type DetectedSituation,
  type EcowattResponse,
  type EcowattSignal,
  type FloodSegment,
  type IntelEventsState,
  type MarketData,
  type MeteoAlert,
  type NewsEvent,
} from '../types/index.ts';
import {
  LEVEL_RANK,
  eventLevel,
  formatSignedPct,
  levelLabel,
  levelVigilanceWord,
  marketTone,
  maxLevel,
  officialLevel,
  situationLevel,
  type VigilanceLevel,
} from './vigilance.ts';
import { SPECIFIC_THEMES, THEMES, categoryTheme, inTheme, situationTheme, type SpecificThemeId, type ThemeId } from './themes.ts';
import type { VisitBaseline } from './intel-last-visit.ts';
import { splitZoneScore } from './situation-text.ts';

type Lang = 'fr' | 'en';

export type WorkBadge = 'nouveau' | 'aggrave' | null;
export type OfficialSource = 'ecowatt' | 'meteo' | 'vigicrues';
export type EventsStatus = 'loading' | 'ok' | 'unavailable';

/** Alertes officielles d'une même source et d'un même niveau (orange ou rouge), en une ligne. */
export interface OfficialAlertGroup {
  source: OfficialSource;
  level: VigilanceLevel;
  places: string[];
  /** Une ligne par lieu (« Var : Canicule, Orages »). */
  details: string[];
}

/** Niveau le plus élevé d'une source officielle, vert compris : sert au niveau des thèmes. */
export interface OfficialSignal {
  source: OfficialSource;
  level: VigilanceLevel;
  /** Nombre de lieux à ce niveau. */
  places: number;
}

/** Ligne de marché suivie : indice boursier (seuil ±3 %) ou énergie (pétrole, gaz : ±5 %). */
export interface MarketLine {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  kind: 'index' | 'energy';
}

export type WorkRef =
  | { kind: 'situation'; situation: DetectedSituation }
  | { kind: 'alert'; situation: DetectedSituation }
  | { kind: 'official'; group: OfficialAlertGroup }
  | { kind: 'event'; event: NewsEvent }
  | { kind: 'market'; line: MarketLine };

export interface WorkItem {
  /** Clé stable : « situation:<id> », « alert:<id> », « event:<id> », « official:<source>:<niveau> », « market:<symbole> ». */
  key: string;
  level: VigilanceLevel;
  title: string;
  place: string | null;
  /** Début connu (ms epoch), null si inconnu. */
  since: number | null;
  independentSources: number | null;
  theme: ThemeId;
  badge: WorkBadge;
  ref: WorkRef;
}

export interface WorkQueueInput {
  situations: readonly DetectedSituation[];
  alerts: readonly DetectedSituation[];
  /** null tant que le premier chargement des événements n'a pas abouti. */
  events: IntelEventsState | null;
  ecowatt: EcowattResponse | null;
  meteo: readonly MeteoAlert[];
  floods: readonly FloodSegment[];
  markets: readonly MarketLine[];
  /** Niveaux vus à la dernière visite ; null à la première visite. */
  baseline: VisitBaseline | null;
  /** Heure d'apparition pendant la session, par clé (après la chauffe du démarrage). */
  firstSeen: ReadonlyMap<string, number>;
  lang: Lang;
}

export interface WorkQueue {
  /** Tous thèmes confondus, triés (§7.2). */
  items: WorkItem[];
  official: OfficialSignal[];
  /** Niveau de chaque thème : ses signaux officiels (jaune compris) et ses éléments « À traiter ». */
  themeLevels: Record<SpecificThemeId, VigilanceLevel>;
  /** Éléments suivis restés au vert, par thème (arbitrage A10). */
  greenTracked: Record<ThemeId, number>;
  eventsStatus: EventsStatus;
}

// Même table que situation-engine.ts et SituationReport.ts (codes INSEE des régions Écowatt).
const ECOWATT_REGION_NAMES: Record<string, string> = {
  '11': 'Île-de-France',
  '24': 'Centre-Val de Loire',
  '27': 'Bourgogne-Franche-Comté',
  '28': 'Normandie',
  '32': 'Hauts-de-France',
  '44': 'Grand Est',
  '52': 'Pays de la Loire',
  '53': 'Bretagne',
  '75': 'Nouvelle-Aquitaine',
  '76': 'Occitanie',
  '84': 'Auvergne-Rhône-Alpes',
  '93': 'PACA',
  '94': 'Corse',
};

const OFFICIAL_THEME: Record<OfficialSource, SpecificThemeId> = {
  ecowatt: 'energy',
  meteo: 'environment',
  vigicrues: 'environment',
};

const OFFICIAL_SOURCE_NAME: Record<OfficialSource, string> = {
  ecowatt: 'RTE Écowatt',
  meteo: 'Météo-France',
  vigicrues: 'Vigicrues',
};

const OFFICIAL_SOURCES: readonly OfficialSource[] = ['ecowatt', 'meteo', 'vigicrues'];

export function officialTheme(source: OfficialSource): SpecificThemeId {
  return OFFICIAL_THEME[source];
}

export function officialSourceName(source: OfficialSource): string {
  return OFFICIAL_SOURCE_NAME[source];
}

interface OfficialEntry {
  source: OfficialSource;
  level: VigilanceLevel;
  place: string;
  detail: string;
}

function officialEntries(ecowatt: EcowattResponse | null, meteo: readonly MeteoAlert[], floods: readonly FloodSegment[]): OfficialEntry[] {
  const out: OfficialEntry[] = [];
  const signals: Record<string, EcowattSignal> = ecowatt?.signals ?? {};
  for (const [code, signal] of Object.entries(signals)) {
    const place = ECOWATT_REGION_NAMES[code] ?? `Région ${code}`;
    out.push({ source: 'ecowatt', level: officialLevel(signal), place, detail: place });
  }
  for (const alert of meteo) {
    const risks = alert.risks.map((risk) => RISK_LABELS[risk] ?? risk).join(', ');
    out.push({
      source: 'meteo',
      level: officialLevel(alert.level),
      place: alert.department,
      detail: risks ? `${alert.department} : ${risks}` : alert.department,
    });
  }
  for (const segment of floods) {
    out.push({ source: 'vigicrues', level: officialLevel(segment.level), place: segment.name, detail: segment.name });
  }
  return out;
}

/** Alertes officielles orange ou rouges, regroupées par source et par niveau ; violet Météo = rouge. */
export function officialAlertGroups(
  ecowatt: EcowattResponse | null,
  meteo: readonly MeteoAlert[],
  floods: readonly FloodSegment[],
): OfficialAlertGroup[] {
  const groups = new Map<string, OfficialAlertGroup>();
  for (const entry of officialEntries(ecowatt, meteo, floods)) {
    if (LEVEL_RANK[entry.level] < LEVEL_RANK.orange) continue;
    const key = `${entry.source}:${entry.level}`;
    const group = groups.get(key) ?? { source: entry.source, level: entry.level, places: [], details: [] };
    if (!group.places.includes(entry.place)) {
      group.places.push(entry.place);
      group.details.push(entry.detail);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Niveau maximal de chaque source officielle présente (vert compris). */
export function officialSignals(
  ecowatt: EcowattResponse | null,
  meteo: readonly MeteoAlert[],
  floods: readonly FloodSegment[],
): OfficialSignal[] {
  const entries = officialEntries(ecowatt, meteo, floods);
  return OFFICIAL_SOURCES.flatMap((source) => {
    const own = entries.filter((e) => e.source === source);
    if (own.length === 0) return [];
    const level = maxLevel(own.map((e) => e.level));
    return [{ source, level, places: own.filter((e) => e.level === level).length }];
  });
}

export function officialTitle(group: OfficialAlertGroup, lang: Lang): string {
  const n = group.places.length;
  const s = n > 1 ? 's' : '';
  const word = levelLabel(group.level, lang).toLowerCase();
  if (lang === 'en') {
    if (group.source === 'ecowatt') return `Ecowatt: ${word} signal in ${n} region${s}`;
    if (group.source === 'meteo') return `Weather ${levelVigilanceWord(group.level, 'en')}: ${n} department${s}`;
    return `Vigicrues ${word}: ${n} river section${s}`;
  }
  if (group.source === 'ecowatt') return `Écowatt : signal ${word} sur ${n} région${s}`;
  if (group.source === 'meteo') return `Vigilance météo ${word} : ${n} département${s}`;
  return `Vigicrues ${word} : ${n} tronçon${s}`;
}

/** Lignes de marché suivies : indices (catégorie « indices ») et énergie des matières premières. */
export function marketLines(markets: readonly MarketData[], commodities: readonly CommodityData[]): MarketLine[] {
  return [
    ...markets
      .filter((m) => m.category === 'indices')
      .map((m) => ({ symbol: m.symbol, name: m.name, price: m.price, changePercent: m.changePercent, kind: 'index' as const })),
    ...commodities
      .filter((c) => c.category === 'energy')
      .map((c) => ({ symbol: c.symbol, name: c.name, price: c.price, changePercent: c.changePercent, kind: 'energy' as const })),
  ];
}

function marketTitle(line: MarketLine, lang: Lang): string {
  return lang === 'fr'
    ? `${line.name} : ${formatSignedPct(line.changePercent)} sur la journée`
    : `${line.name}: ${formatSignedPct(line.changePercent)} today`;
}

function placesLabel(places: readonly string[]): string | null {
  if (places.length === 0) return null;
  if (places.length <= 2) return places.join(', ');
  return `${places.slice(0, 2).join(', ')} +${places.length - 2}`;
}

/** Lieu d'une ligne : la première zone, sans son sous-score « (72/100) » (relecture finale I4, A7). */
function firstZone(zones: readonly string[]): string | null {
  return zones.length > 0 ? splitZoneScore(zones[0]).name : null;
}

function parseTime(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Même histoire qu'un événement consolidé : titres égaux, ou préfixe commun d'au moins 20 caractères (titres d'alerte tronqués). */
function sameStory(alertTitle: string, eventTitles: readonly string[]): boolean {
  const a = normalizeTitle(alertTitle);
  return eventTitles.some((e) => e === a || (a.length >= 20 && e.length >= 20 && (e.startsWith(a) || a.startsWith(e))));
}

function eventEnters(e: NewsEvent): boolean {
  if (e.status === 'closed') return false;
  const rank = LEVEL_RANK[eventLevel(e.severity)];
  if (rank < LEVEL_RANK.jaune) return false;
  return e.independentCount >= 2 || rank >= LEVEL_RANK.orange;
}

/** Gravité en fin d'identifiant d'une poussée militaire (App.ts : `military-surge-<type>-<gravité>`). */
const MILITARY_SURGE_SEVERITY_SUFFIX = /-(?:info|warning|alert)$/;

/**
 * Identité de ligne de base d'un élément (relecture finale m2) : sa clé d'affichage, sauf quand
 * celle-ci contient le niveau — alerte officielle (« official:<source>:<niveau> » → la source,
 * « official:<source> ») et poussée militaire (« alert:military-surge-<type>-<gravité> » →
 * « alert:military-surge-<type> »). Même identité à un niveau plus haut → « AGGRAVÉ », jamais
 * « NOUVEAU ». Les clés d'affichage (et celles de la v1) ne changent pas.
 */
export function baselineIdentity(item: Pick<WorkItem, 'key' | 'ref'>): string {
  if (item.ref.kind === 'official') return `official:${item.ref.group.source}`;
  if (item.ref.kind === 'alert' && item.ref.situation.type === 'MILITARY_SURGE_ALERT') {
    return item.key.replace(MILITARY_SURGE_SEVERITY_SUFFIX, '');
  }
  return item.key;
}

/** Badge depuis la visite : identité absente → nouveau ; niveau plus haut → aggravé ; sinon rien. */
function baselineBadge(identity: string, level: VigilanceLevel, baseline: VisitBaseline | null): WorkBadge {
  if (baseline === null) return null;
  const before: VigilanceLevel | undefined = baseline[identity];
  if (before === undefined) return 'nouveau';
  return LEVEL_RANK[level] > LEVEL_RANK[before] ? 'aggrave' : null;
}

function eventBadge(event: NewsEvent, events: IntelEventsState): WorkBadge {
  const item = events.digest.find((d) => d.event.id === event.id);
  if (!item) return null;
  if (item.kinds.includes('created')) return 'nouveau';
  return item.kinds.includes('escalated') || item.kinds.includes('reopened') ? 'aggrave' : null;
}

/** Tri §7.2 : rouge d'abord, puis nouveau ou aggravé, puis le plus récent ; la clé départage. */
export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  return LEVEL_RANK[b.level] - LEVEL_RANK[a.level]
    || Number(b.badge !== null) - Number(a.badge !== null)
    || (b.since ?? 0) - (a.since ?? 0)
    || a.key.localeCompare(b.key);
}

export function buildWorkQueue(input: WorkQueueInput): WorkQueue {
  const { baseline, firstSeen, lang } = input;
  const seenAt = (key: string): number | null => firstSeen.get(key) ?? null;
  const items: WorkItem[] = [];

  for (const s of input.situations) {
    const key = `situation:${s.id}`;
    const level = situationLevel(s.severity);
    items.push({
      key, level, title: s.title, place: firstZone(s.affectedZones), since: seenAt(key), independentSources: null,
      theme: situationTheme(s.type), badge: baselineBadge(key, level, baseline), ref: { kind: 'situation', situation: s },
    });
  }

  const situationIds = new Set(input.situations.map((s) => s.id));
  // Relecture finale m3 (§14) : seulement les événements qui entrent dans la liste — un jumeau
  // absent de la liste ne doit pas faire disparaître l'alerte.
  const eventTitles = (input.events?.events ?? []).filter(eventEnters).map((e) => normalizeTitle(e.title));
  for (const a of input.alerts) {
    // Arbitrages A2 et A3 : la météo est couverte par les lignes officielles, un incendie par la
    // situation du moteur de même identifiant, une alerte presse par l'événement de même titre.
    if (a.type === 'WEATHER_ALERT' || situationIds.has(a.id)) continue;
    if (a.type === 'NEWS_ALERT' && sameStory(a.title, eventTitles)) continue;
    const key = `alert:${a.id}`;
    const level = situationLevel(a.severity);
    const since = a.updatedAt.getTime();
    const ref: WorkRef = { kind: 'alert', situation: a };
    items.push({
      key, level, title: a.title, place: firstZone(a.affectedZones), since: Number.isFinite(since) ? since : null,
      independentSources: null, theme: situationTheme(a.type, a.category),
      badge: baselineBadge(baselineIdentity({ key, ref }), level, baseline), ref,
    });
  }

  for (const group of officialAlertGroups(input.ecowatt, input.meteo, input.floods)) {
    const key = `official:${group.source}:${group.level}`;
    const ref: WorkRef = { kind: 'official', group };
    items.push({
      key, level: group.level, title: officialTitle(group, lang), place: placesLabel(group.places), since: seenAt(key),
      independentSources: null, theme: OFFICIAL_THEME[group.source],
      badge: baselineBadge(baselineIdentity({ key, ref }), group.level, baseline), ref,
    });
  }

  const events = input.events;
  if (events) {
    for (const e of events.events) {
      if (!eventEnters(e)) continue;
      items.push({
        key: `event:${e.id}`, level: eventLevel(e.severity), title: e.title, place: null, since: parseTime(e.firstSeen),
        independentSources: e.independentCount, theme: categoryTheme(e.category), badge: eventBadge(e, events),
        ref: { kind: 'event', event: e },
      });
    }
  }

  for (const line of input.markets) {
    if (marketTone(line.changePercent, line.kind) !== 'alert') continue;
    const key = `market:${line.symbol}`;
    items.push({
      key, level: 'jaune', title: marketTitle(line, lang), place: null, since: seenAt(key), independentSources: null,
      theme: line.kind === 'energy' ? 'energy' : 'general', badge: baselineBadge(key, 'jaune', baseline),
      ref: { kind: 'market', line },
    });
  }

  items.sort(compareWorkItems);

  const official = officialSignals(input.ecowatt, input.meteo, input.floods);
  const themeLevel = (theme: SpecificThemeId): VigilanceLevel => maxLevel([
    ...official.filter((o) => OFFICIAL_THEME[o.source] === theme).map((o) => o.level),
    ...items.filter((i) => i.theme === theme).map((i) => i.level),
  ]);
  const themeLevels: Record<SpecificThemeId, VigilanceLevel> = {
    energy: themeLevel('energy'),
    security: themeLevel('security'),
    health: themeLevel('health'),
    environment: themeLevel('environment'),
  };

  const greenTracked: Record<ThemeId, number> = { general: 0, energy: 0, security: 0, health: 0, environment: 0 };
  const countGreen = (theme: ThemeId): void => {
    greenTracked.general += 1;
    if (theme !== 'general') greenTracked[theme] += 1;
  };
  for (const o of official) if (o.level === 'vert') countGreen(OFFICIAL_THEME[o.source]);
  for (const e of events?.events ?? []) {
    if (e.status !== 'closed' && eventLevel(e.severity) === 'vert') countGreen(categoryTheme(e.category));
  }
  for (const line of input.markets) {
    if (Number.isFinite(line.changePercent) && marketTone(line.changePercent, line.kind) === 'neutral') {
      countGreen(line.kind === 'energy' ? 'energy' : 'general');
    }
  }

  const eventsStatus: EventsStatus = events === null
    ? 'loading'
    : events.unavailable && events.events.length === 0 ? 'unavailable' : 'ok';

  return { items, official, themeLevels, greenTracked, eventsStatus };
}

/**
 * Niveaux à enregistrer comme ligne de base de la visite (les événements ont leur fil serveur),
 * par identité (baselineIdentity) : le niveau le plus élevé quand plusieurs lignes la partagent
 * (alertes officielles orange et rouges d'une même source).
 */
export function levelsForBaseline(queue: WorkQueue): VisitBaseline {
  const levels: Record<string, VigilanceLevel> = {};
  for (const item of queue.items) {
    if (item.ref.kind === 'event') continue;
    const identity = baselineIdentity(item);
    const before: VigilanceLevel | undefined = levels[identity];
    levels[identity] = before === undefined ? item.level : maxLevel([before, item.level]);
  }
  return levels;
}

// ─── Vue par thème, garde et thèmes qui tirent le niveau (spec §5.2, §7.2, §7.3) ─────────────

export const WORK_LIST_CAP = 12;

export interface WorkGuard {
  reds: number;
  /** Thèmes des rouges hors du thème courant, dans l'ordre de la barre de thèmes. */
  themes: ThemeId[];
  /** Thème vers lequel bascule un clic : celui qui a le plus de rouges hors du thème courant. */
  target: ThemeId;
}

export interface WorkQueueView {
  theme: ThemeId;
  rows: WorkItem[];
  total: number;
  hiddenCount: number;
  guard: WorkGuard | null;
  greenTracked: number;
  eventsStatus: EventsStatus;
}

export function viewWorkQueue(queue: WorkQueue, theme: ThemeId, showAll: boolean): WorkQueueView {
  const inside = queue.items.filter((i) => inTheme(i.theme, theme));
  const rows = showAll ? inside : inside.slice(0, WORK_LIST_CAP);
  const outsideReds = queue.items.filter((i) => i.level === 'rouge' && !inTheme(i.theme, theme));
  let guard: WorkGuard | null = null;
  if (outsideReds.length > 0) {
    const counts = new Map<ThemeId, number>();
    for (const i of outsideReds) counts.set(i.theme, (counts.get(i.theme) ?? 0) + 1);
    const themes = THEMES.map((th) => th.id).filter((id) => counts.has(id));
    // Tri stable : à égalité, l'ordre de la barre de thèmes départage.
    const target = [...themes].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
    guard = { reds: outsideReds.length, themes, target };
  }
  return {
    theme,
    rows,
    total: inside.length,
    hiddenCount: inside.length - rows.length,
    guard,
    greenTracked: queue.greenTracked[theme],
    eventsStatus: queue.eventsStatus,
  };
}

/**
 * Thèmes qui tirent le niveau national (spec §5.2) : ceux qui sont au niveau national, deux au
 * plus ; s'il n'y en a aucun, le thème au niveau le plus élevé ; aucun si tous sont verts.
 */
export function drivingThemes(themeLevels: Record<SpecificThemeId, VigilanceLevel>, national: VigilanceLevel): SpecificThemeId[] {
  const top = maxLevel(SPECIFIC_THEMES.map((th) => themeLevels[th]));
  if (top === 'vert') return [];
  const equal: SpecificThemeId[] = national === 'vert' ? [] : SPECIFIC_THEMES.filter((th) => themeLevels[th] === national);
  if (equal.length > 0) return equal.slice(0, 2);
  return SPECIFIC_THEMES.filter((th) => themeLevels[th] === top).slice(0, 1);
}

/** Changements depuis la visite, toute la liste (bandeau d'état). */
export function visitCounts(queue: WorkQueue): { nouveaux: number; aggravations: number } {
  return {
    nouveaux: queue.items.filter((i) => i.badge === 'nouveau').length,
    aggravations: queue.items.filter((i) => i.badge === 'aggrave').length,
  };
}
