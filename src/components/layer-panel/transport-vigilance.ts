// src/components/layer-panel/transport-vigilance.ts : points de vigilance de l'onglet Transports (lots 1 et 2, 25/10/2026). Pur, sans
// DOM ni réseau. Ce qui demande attention, placé sur la carte (numéros pulsants) et repris dans l'En bref, dans le même ordre :
// axes ou régions ferroviaires où au moins 3 trains ont 90 min de retard ou plus ou sont supprimés (cause SIRI SX quand elle est
// publiée), événements météo et coupures non planifiées des DIR, urgences 7500 et 7700 confirmées au-dessus du territoire, navires
// en difficulté confirmée. Jamais une couleur inventée : orange ou rouge seulement, selon les mêmes seuils que les pastilles.
import type {
  AirOverviewResponse, MaritimeSnapshot, RailAxis, RailOverviewResponse, RailSituation, RailSituationsResponse, RailTrain, RoadEvent,
  RoadNationalResponse,
} from '../../types/index.ts';
import { emergencyColoursPill } from '../../services/traffic-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { NBSP, frNumber } from './format.ts';
import { RAIL_AXIS_LABEL, SQUAWK_WORD, clockOf, fold, formatMinutes } from './traffic-format.ts';

export type TransportMode = 'trafficRail' | 'trafficRoad' | 'trafficAir' | 'trafficMaritime';

export interface TransportVigilancePoint {
  /** Numéro affiché sur la carte et dans l'En bref (1 = le plus grave). */
  n: number;
  id: string;
  mode: TransportMode;
  level: Extract<VigilanceLevel, 'orange' | 'rouge'>;
  lon: number;
  lat: number;
  /** Titre court de l'étiquette (« Axe Atlantique »). */
  title: string;
  /** Deuxième ligne de l'étiquette (« 6 trains · jusqu'à 390 min »). */
  short: string;
  /** Phrase complète de l'En bref. */
  detail: string;
  /** Cause publiée par l'exploitant ; null : non précisée. */
  cause: string | null;
  /** Cause publiée par la source (« annoncée ») ou rien de publié (« à vérifier »). */
  causeTag: 'annoncée' | 'à vérifier';
  /** Qui est concerné (exploitant, gestionnaire). */
  who: string;
  /** Trajets des trains concernés ([lon, lat] par arrêt), allumés sur la carte au survol du point ; absent hors rail. */
  routes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** Point fait d'un seul train supprimé (classé après les autres modes). */
  lone?: boolean;
}

export interface TransportVigilanceInput {
  rail: RailOverviewResponse | null;
  situations: RailSituationsResponse | null;
  road: RoadNationalResponse | null;
  air: AirOverviewResponse | null;
  maritime: MaritimeSnapshot | null;
  now: number;
}

/** Retard à partir duquel un train est « très retardé » (seuil rouge d'une gare ou d'un train, railDelayLevel). */
export const HEAVY_DELAY_MIN = 90;
/** Trains très retardés ou supprimés d'un même axe ou d'une même région pour faire un point : 2 (orange, 25/10/2026), 5 (rouge). */
const RAIL_POINT_MIN = 2;
const RAIL_POINT_RED = 5;
/** Gares privées de desserte à partir desquelles un seul train supprimé fait un point (25/10/2026). */
const LONE_TRAIN_MIN_STOPS = 8;
/** Une situation SIRI SX vaut cause si elle a commencé il y a moins de 6 h. */
const CAUSE_WINDOW_MS = 6 * 3_600_000;
const MAX_ROAD_POINTS = 4;
const MAX_POINTS = 9;

const MODE_ORDER: Readonly<Record<TransportMode, number>> = { trafficRail: 0, trafficRoad: 1, trafficAir: 2, trafficMaritime: 3 };

/** Portées SIRI SX d'un axe grandes lignes (« Axe Atlantique », « Intercités »). */
const AXIS_SCOPES: Readonly<Record<RailAxis, readonly string[]>> = {
  'sud-est': ['axe sud-est'], atlantique: ['axe atlantique'], nord: ['axe nord'], est: ['axe est'], 'intercites-bercy': ['intercites'],
  normandie: ['axe normandie', 'normandie'], province: [],
};

/** Nom de gare lisible : « Paris - Montparnasse - Hall 1 & 2 » devient « Paris Montparnasse ». */
export function stationName(name: string): string {
  return name.replace(/\s+-\s+Hall\b.*$/i, '').replace(/\s+-\s+/g, ' ').trim();
}

function isHeavy(t: RailTrain): boolean {
  return t.status === 'en-cours' && (t.effect === 'supprime' || (t.delayMin !== null && t.delayMin >= HEAVY_DELAY_MIN));
}

/** Groupe d'un train : son axe grandes lignes s'il en a un, sinon sa région TER. */
function railGroupOf(t: RailTrain): { key: string; label: string; axis: RailAxis | null } | null {
  if (t.kind === 'grandes-lignes' && t.axis) return { key: `axe:${t.axis}`, label: `Axe ${RAIL_AXIS_LABEL[t.axis]}`, axis: t.axis };
  if (t.region) return { key: `region:${fold(t.region)}`, label: `TER ${t.region}`, axis: null };
  return null;
}

/**
 * Lignes distinctes d'un axe grandes lignes : deux trains sont sur la même ligne s'ils ont une gare en commun (de proche en proche).
 * L'axe « Province, transversales » réunit ainsi Bordeaux–Marseille et Nantes–Paris Austerlitz, sans gare commune : deux points,
 * chacun avec ses trains et ses trajets (25/10/2026 : une étiquette à Toulouse allumait aussi Nantes–Paris).
 */
function railLines(trains: readonly RailTrain[]): RailTrain[][] {
  const parent = trains.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const seen = new Map<string, number>();
  trains.forEach((t, i) => {
    for (const st of t.stops) {
      const key = fold(stationName(st.name));
      const j = seen.get(key);
      if (j === undefined) seen.set(key, i);
      else parent[root(i)] = root(j);
    }
  });
  const lines = new Map<number, RailTrain[]>();
  trains.forEach((t, i) => lines.set(root(i), [...(lines.get(root(i)) ?? []), t]));
  return [...lines.values()];
}

/** Ville d'une gare pour nommer une ligne : « Bordeaux Saint-Jean » devient « Bordeaux » ; gares parisiennes et « Le Mans » gardées. */
function cityOf(station: string): string {
  const words = station.split(' ');
  if (words.length < 2 || words[0] === 'Paris' || /^(le|la|les|l’|saint|sainte)$/i.test(words[0] ?? '')) return station;
  return words[0] ?? station;
}

/** « Bordeaux–Marseille » : les deux terminus les plus fréquents d'une ligne, dans l'ordre du premier train. */
function lineName(trains: readonly RailTrain[]): string {
  const counts = new Map<string, number>();
  for (const t of trains) {
    const ends = [t.stops[0], t.stops[t.stops.length - 1]].filter((s): s is RailTrain['stops'][number] => s !== undefined);
    for (const s of ends) counts.set(stationName(s.name), (counts.get(stationName(s.name)) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  const order = trains[0]?.stops.map((s) => stationName(s.name)) ?? [];
  return top.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)).map(cityOf).join('–');
}

/** Distance approchée en km (équirectangulaire, suffisante à l'échelle d'une agglomération). */
function km(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(x, b.lat - a.lat) * 111.2;
}

/** Deux points plus proches que ce rayon se superposent sur la carte de France. */
const ANCHOR_SPACING_KM = 25;

/**
 * Gare d'ancrage du point : la plus desservie par les trains du groupe ; une gare hors de Paris desservie par au moins 60 % d'autant
 * de trains passe devant (les gares parisiennes, à moins de 3 km l'une de l'autre, superposaient les étiquettes). Une gare à moins de
 * 25 km d'un point déjà placé cède la place à une autre gare desservie par au moins un tiers des trains, s'il y en a une.
 */
function anchorStation(trains: readonly RailTrain[], used: ReadonlyArray<{ lon: number; lat: number }>): { name: string; lon: number; lat: number } | null {
  const counts = new Map<string, { name: string; lon: number; lat: number; n: number }>();
  for (const t of trains) {
    const seen = new Set<string>();
    for (const s of t.stops) {
      const key = fold(stationName(s.name));
      if (seen.has(key)) continue;
      seen.add(key);
      const c = counts.get(key) ?? { name: stationName(s.name), lon: s.lon, lat: s.lat, n: 0 };
      c.n += 1;
      counts.set(key, c);
    }
  }
  const all = [...counts.values()];
  const max = Math.max(0, ...all.map((c) => c.n));
  const free = all.filter((c) => c.n >= Math.ceil(max / 3) && used.every((u) => km(u, c) >= ANCHOR_SPACING_KM));
  const pool = free.length > 0 ? free : all;
  const isParis = (name: string): boolean => fold(name).startsWith('paris');
  const best = (list: ReadonlyArray<{ name: string; lon: number; lat: number; n: number }>): { name: string; lon: number; lat: number; n: number } | null => {
    let b: { name: string; lon: number; lat: number; n: number } | null = null;
    for (const c of list) if (!b || c.n > b.n) b = c;
    return b;
  };
  const top = best(pool);
  const outside = best(pool.filter((c) => !isParis(c.name)));
  return outside && top && outside.n >= Math.ceil(top.n * 0.6) ? outside : top;
}

/**
 * Situation SIRI SX qui explique le groupe, moins de 6 h, travaux exclus, la plus récente : de même portée (cause « annoncée »), sinon
 * une situation qui cite une gare du groupe (lien seulement possible : « à vérifier »).
 */
export function railCause(
  situations: readonly RailSituation[], group: { axis: RailAxis | null; region: string | null }, stations: readonly string[], now: number,
): { situation: RailSituation; sameScope: boolean } | null {
  const scopes = group.axis ? AXIS_SCOPES[group.axis] : group.region ? [fold(group.region)] : [];
  const names = stations.map((s) => fold(s)).filter((s) => s.length >= 5);
  let best: { situation: RailSituation; sameScope: boolean; at: number } | null = null;
  for (const s of situations) {
    if (s.causeKind === 'travaux' || s.cause === null || s.cause.trim() === '') continue;
    const at = Date.parse(s.start);
    if (!Number.isFinite(at) || Math.abs(now - at) > CAUSE_WINDOW_MS) continue;
    const sameScope = scopes.includes(fold(s.scope));
    const text = fold(`${s.title} ${s.cause}`);
    if (!sameScope && !names.some((n) => text.includes(n))) continue;
    // Même portée d'abord, puis la plus récente.
    if (!best || (sameScope && !best.sameScope) || (sameScope === best.sameScope && at > best.at)) best = { situation: s, sameScope, at };
  }
  return best ? { situation: best.situation, sameScope: best.sameScope } : null;
}

function trainWords(t: RailTrain): string {
  const route = `${stationName(t.origin)}-${stationName(t.destination)}`;
  const value = t.effect === 'supprime' ? 'supprimé' : formatMinutes(t.delayMin);
  return `n°${NBSP}${t.number} ${route} (${value})`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function railPoints(input: TransportVigilanceInput): TransportVigilancePoint[] {
  const rail = input.rail;
  if (!rail || rail.updatedAt === null) return [];
  const groups = new Map<string, { label: string; axis: RailAxis | null; region: string | null; trains: RailTrain[] }>();
  for (const t of rail.trains) {
    if (!isHeavy(t)) continue;
    const g = railGroupOf(t);
    if (!g) continue;
    const entry = groups.get(g.key) ?? { label: g.label, axis: g.axis, region: g.axis ? null : t.region, trains: [] };
    entry.trains.push(t);
    groups.set(g.key, entry);
  }
  // Un axe grandes lignes comme une région TER se scinde en ses lignes distinctes (25/10/2026 : « TER Nouvelle-Aquitaine »
  // réunissait Hendaye–Lourdes, Monsempron–Agen et Limoges–Saillat sous une étiquette posée à Agen).
  const split: Array<[string, { label: string; axis: RailAxis | null; region: string | null; trains: RailTrain[] }]> = [];
  for (const [key, g] of groups) {
    const lines = railLines(g.trains);
    if (lines.length === 1 && g.axis !== null && g.axis !== 'province') { split.push([key, g]); continue; }
    for (const trains of lines) {
      const name = lineName(trains);
      const label = g.axis === 'province' ? `Transversale ${name}` : g.axis ? `${g.label} · ${name}` : `TER ${name}`;
      split.push([`${key}:${fold(name)}`, { ...g, label, trains }]);
    }
  }
  const out: TransportVigilancePoint[] = [];
  // Le groupe le plus touché choisit sa gare d'abord. Un seul train supprimé fait un point quand il prive au moins
  // LONE_TRAIN_MIN_STOPS gares de desserte (toute une ligne rouge sur la carte, sans étiquette sinon).
  const qualifies = (trains: readonly RailTrain[]): boolean => trains.length >= RAIL_POINT_MIN
    || (trains.length === 1 && trains[0]?.effect === 'supprime' && trains[0].stops.length >= LONE_TRAIN_MIN_STOPS);
  const ordered = split.filter(([, g]) => qualifies(g.trains)).sort((a, b) => b[1].trains.length - a[1].trains.length);
  for (const [key, g] of ordered) {
    const at = anchorStation(g.trains, out);
    if (!at) continue;
    const cancelled = g.trains.filter((t) => t.effect === 'supprime').length;
    const delays = g.trains.map((t) => t.delayMin ?? 0);
    const max = Math.max(...delays);
    const n = g.trains.length;
    const lone = n === 1 ? g.trains[0] : undefined;
    const short = lone ? `1 train supprimé · ${lone.stops.length} gares sans desserte`
      : cancelled === n ? `${n} trains supprimés`
      : `${n} trains · jusqu’à ${formatMinutes(max)}${cancelled > 0 ? ` · ${cancelled} supprimé${cancelled > 1 ? 's' : ''}` : ''}`;
    const worst = [...g.trains].sort((a, b) => (b.effect === 'supprime' ? 1 : 0) - (a.effect === 'supprime' ? 1 : 0) || (b.delayMin ?? 0) - (a.delayMin ?? 0)).slice(0, 3);
    const stations = [...new Set(g.trains.flatMap((t) => t.stops.map((s) => stationName(s.name))))];
    const cause = railCause(input.situations?.situations ?? [], g, stations, input.now);
    out.push({
      n: 0, id: `rail-${key}`, mode: 'trafficRail', level: n >= RAIL_POINT_RED ? 'rouge' : 'orange', lon: at.lon, lat: at.lat,
      title: g.label, short,
      detail: lone ? `${capital(trainWords(lone))}, ${lone.stops.length} gares sans desserte.`
        : `${n} trains à ${formatMinutes(HEAVY_DELAY_MIN)} de retard ou plus, ou supprimés, autour de ${at.name} ; ${worst.map(trainWords).join(' ; ')}.`,
      cause: cause ? `${cause.sameScope ? '' : 'Possible : '}${cause.sameScope ? capital(cause.situation.cause ?? '') : cause.situation.cause ?? ''} (SIRI SX, ${clockOf(cause.situation.start, input.now)})` : null,
      causeTag: cause?.sameScope ? 'annoncée' : 'à vérifier',
      who: g.axis === 'intercites-bercy' ? 'SNCF Voyageurs, Intercités (État autorité organisatrice)'
        : g.axis ? 'SNCF Voyageurs et SNCF Réseau' : `Région ${g.region ?? ''} (TER) et SNCF Réseau`.trim(),
      ...(lone ? { lone: true } : {}),
      routes: g.trains.filter((t) => t.stops.length >= 2).map((t) => t.stops.map((st) => [st.lon, st.lat] as const)),
    });
  }
  return out;
}

const ROAD_POINT_KINDS: ReadonlySet<RoadEvent['kind']> = new Set(['weather', 'closure']);

function roadPoints(input: TransportVigilanceInput): TransportVigilancePoint[] {
  const road = input.road;
  if (!road || road.publishedAt === null) return [];
  const events = road.events.filter((e) => ROAD_POINT_KINDS.has(e.kind) && !e.planned && !e.longTerm && e.lat !== null && e.lon !== null);
  events.sort((a, b) => (a.kind === 'weather' ? 0 : 1) - (b.kind === 'weather' ? 0 : 1) || Date.parse(b.start) - Date.parse(a.start));
  // Même événement publié deux fois par la DIR (même nature, route et lieu, deux sens) : un seul point.
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const key = `${e.kind}|${fold(e.road ?? '')}|${fold(e.place ?? '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, MAX_ROAD_POINTS).map((e): TransportVigilancePoint => {
    const where = [e.road, e.place].filter((x): x is string => typeof x === 'string' && x !== '');
    return {
      n: 0, id: `road-${e.id}`, mode: 'trafficRoad', level: 'orange', lon: e.lon ?? 0, lat: e.lat ?? 0,
      title: e.road ? `${e.label} · ${e.road}` : e.label,
      short: `${e.place ?? e.dir} · depuis ${clockOf(e.start, input.now)}`,
      detail: `${e.label}${where.length > 0 ? ` : ${where.join(', ')}` : ''}${e.direction ? `, ${e.direction}` : ''}${e.detail ? ` (${e.detail})` : ''}.`,
      cause: e.kind === 'weather' ? 'Événement météo signalé par la DIR' : null,
      causeTag: e.kind === 'weather' ? 'annoncée' : 'à vérifier',
      who: e.dir,
    };
  });
}

function airPoints(input: TransportVigilanceInput): TransportVigilancePoint[] {
  const air = input.air;
  if (!air || air.at === null) return [];
  return air.emergencies.filter((e) => emergencyColoursPill(e) && (e.squawk === '7500' || e.squawk === '7700')).map((e): TransportVigilancePoint => {
    const name = e.callsign ?? `ICAO ${e.icao24.toUpperCase()}`;
    return {
      n: 0, id: `air-${e.icao24}`, mode: 'trafficAir', level: e.squawk === '7500' ? 'rouge' : 'orange', lon: e.lon, lat: e.lat,
      title: `${e.squawk}${NBSP}${SQUAWK_WORD[e.squawk]}`, short: `${name} · depuis ${clockOf(e.firstSeen, input.now)}`,
      detail: `${name} affiche le code ${e.squawk} (${SQUAWK_WORD[e.squawk]}) au-dessus du territoire ou de ses approches, vu sur au moins deux relevés${e.altitudeM !== null ? `, à ${frNumber(e.altitudeM, 0)}${NBSP}m` : ''}.`,
      cause: null, causeTag: 'à vérifier', who: 'DGAC, contrôle aérien (DSNA)',
    };
  });
}

function maritimePoints(input: TransportVigilanceInput): TransportVigilancePoint[] {
  const m = input.maritime;
  if (!m || m.at === null) return [];
  return m.signals.filter((s) => s.confirmed).map((s): TransportVigilancePoint => ({
    n: 0, id: `sea-${s.mmsi}`, mode: 'trafficMaritime', level: s.sensitive ? 'rouge' : 'orange', lon: s.lon, lat: s.lat,
    title: s.name ?? `MMSI ${s.mmsi}`, short: `${s.statusLabel} · depuis ${clockOf(s.since, input.now)}`,
    detail: `${s.name ?? `MMSI ${s.mmsi}`}${s.type ? ` (${s.type})` : ''} : ${s.statusLabel}, hors port et immobile depuis 30${NBSP}min${s.sensitive ? ' ; pétrolier ou navire à passagers' : ''}.`,
    cause: null, causeTag: 'à vérifier', who: 'CROSS et préfecture maritime',
  }));
}

/** Points de vigilance, numérotés : rouge d'abord, puis rail, route, aérien, maritime ; au plus 9. */
export function transportVigilancePoints(input: TransportVigilanceInput): TransportVigilancePoint[] {
  const all = [...railPoints(input), ...roadPoints(input), ...airPoints(input), ...maritimePoints(input)];
  // Rouges d'abord ; un train supprimé seul passe après les autres modes (il ne doit pas évincer une coupure de route du plafond).
  const rank = (p: TransportVigilancePoint): number => (p.level === 'rouge' ? 0 : p.lone ? 2 : 1);
  return all
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || MODE_ORDER[a.p.mode] - MODE_ORDER[b.p.mode] || a.i - b.i)
    .slice(0, MAX_POINTS)
    .map(({ p }, i) => ({ ...p, n: i + 1 }));
}

/** Écart à la normale du trafic aérien : en vol dans la zone suivie, comparé à la moyenne des 7 jours précédents à la même heure. */
export function airNormalGap(air: AirOverviewResponse | null): { now: number; normal: number; pct: number } | null {
  if (!air || air.at === null) return null;
  const prev = air.volume.sameHourPrevDays;
  if (prev.length < 7) return null;
  const week = prev.slice(0, 7);
  const normal = week.reduce((sum, v) => sum + v, 0) / week.length;
  if (!(normal > 0)) return null;
  return { now: air.airborneZone, normal, pct: (air.airborneZone / normal - 1) * 100 };
}

/** Gares dessinées en orange ou en rouge (plus fort retard d'un train en cours à l'arrêt, supprimé rouge), comme la carte. */
export function railStationCounts(rail: RailOverviewResponse): { orange: number; rouge: number } {
  const worst = new Map<string, 'orange' | 'rouge'>();
  for (const t of rail.trains) {
    if (t.status !== 'en-cours') continue;
    for (const s of t.stops) {
      const level = t.effect === 'supprime' || (s.delayMin !== null && s.delayMin >= HEAVY_DELAY_MIN) ? 'rouge'
        : s.delayMin !== null && s.delayMin >= 45 ? 'orange' : null;
      if (!level) continue;
      const key = fold(s.name);
      if (worst.get(key) !== 'rouge') worst.set(key, level);
    }
  }
  let orange = 0;
  let rouge = 0;
  for (const l of worst.values()) if (l === 'rouge') rouge += 1; else orange += 1;
  return { orange, rouge };
}
