// src/services/sovereignty-cables.ts : lecture client de la couche Connectivité (spec 2026-10-04 souveraineté § 2.2 ; contrats § 3.3 ;
// amendement 7, O18 et S9). Veille des câbles du serveur (route /api/sovereignty/cables-watch : alertes confirmées ou vues une fois,
// alertes d'une zone au flux muet gardées « non évaluées », aucun compte de navires quand la veille n'est pas évaluée) et fichier
// public des câbles (câbles télécom du Shom en référence, compléments OpenStreetMap, zones de câbles et de mouillage du Shom, source
// et licence par objet), lu une fois par session. Garde de forme exacte élément par élément, lecture qui ne rejette jamais, fusion à
// l'écriture, statut « Câbles et AIS » daté par le dernier message AIS (S1).
import type { CablesWatchResponse, SubseaCablesFile } from '../types/index.ts';
import { isMultiPath } from './environment-source.ts';
import { readHealthJsonShared } from './health-surveillance.ts';
import {
  describeProblems, exactly, isBool, isCount, isCountOrNull, isDate, isDateOrNull, isNum, isNumOrNull, isOneOf, isStr, isStrOrNull,
  isStringList, list, loadSovereigntySlot, mergeSlot, nullable, record, refine, shapeOf, sovereigntySlotStatus, value, type SourceSlot,
  type SovereigntyStatus,
} from './sovereignty-source.ts';

export const CABLES_WATCH_URL = '/api/sovereignty/cables-watch';
/** Cache client : 4 min, sous la relève de 5 min (App.ts). */
export const CABLES_WATCH_TTL_MS = 4 * 60_000;
/** Fichier public des câbles (scripts/fetch-subsea-cables.mjs) : Shom et OpenStreetMap. */
export const CABLES_FILE_URL = '/data/subsea-cables.json';

export interface CablesState { watch: SourceSlot<CablesWatchResponse>; file: SubseaCablesFile | null; fileError: string | null }

const str = value(isStr);
const strOrNull = value(isStrOrNull);
const num = value(isNum);
const bool = value(isBool);
const count = value(isCount);
const date = value(isDate);

/** Alerte câble : `zoneMuted` facultatif dans le type (alertes construites avant ce champ), toujours écrit par le serveur. */
const alert = record({
  id: str, mmsi: str, name: strOrNull, vesselType: strOrNull, cableId: str, cableName: strOrNull, lat: num, lon: num, distanceM: num,
  speedKn: num, navStatus: value(isNumOrNull), firstSeen: date, lastSeen: date, confirmed: bool, zoneMuted: bool,
}, ['zoneMuted']);
const fileMeta = nullable(record({ generatedAt: date, osmBase: date, cables: count, landings: count }));

/** Veille non évaluée : aucun compte de navires (jamais un compte périmé) ; évaluée : un compte. */
const WATCH_SHAPE = shapeOf<CablesWatchResponse>(refine(record({
  readAt: value(isDateOrNull), aisLastMessageAt: value(isDateOrNull), evaluated: bool, cablesFile: fileMeta,
  slowVessels: value(isCountOrNull), alerts: list(alert), errors: value(isStringList),
}), (v) => (v.evaluated === true) === (v.slowVessels !== null), 'slowVessels nul si et seulement si la veille n’est pas évaluée'));

/** Écarts à la forme de /api/sovereignty/cables-watch, nommés un par un ; liste vide : conforme. */
export function cablesWatchProblems(v: unknown): string[] {
  return WATCH_SHAPE.problems(v);
}

export function isCablesWatchResponse(v: unknown): v is CablesWatchResponse {
  return WATCH_SHAPE.is(v);
}

const SOURCES: ReadonlySet<string> = new Set(['Shom', 'OpenStreetMap']);
const LICENCES: ReadonlySet<string> = new Set(['CC BY-SA', 'Licence ouverte 2.0', 'ODbL 1.0']);
/** Licence de chaque source de câbles (O18) : Shom CC BY-SA, OpenStreetMap ODbL 1.0. */
const CABLE_LICENCE: Readonly<Record<string, string>> = { Shom: 'CC BY-SA', OpenStreetMap: 'ODbL 1.0' };
const CATEGORIES: ReadonlySet<string> = new Set(['telecom', 'power']);

/** Polygones [lng, lat] : anneau extérieur puis trous, trois points au moins par anneau. */
const isPolygons = (v: unknown): boolean => Array.isArray(v) && v.every((polygon: unknown) => Array.isArray(polygon)
  && polygon.every((ring: unknown) => Array.isArray(ring) && ring.length >= 3
    && ring.every((p: unknown) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))));

const dataSource = record({
  source: value((v) => isOneOf(v, SOURCES)), dataset: str, layer: str, licence: value((v) => isOneOf(v, LICENCES)), attribution: str,
  edition: strOrNull, url: str, count,
});
const landing = record({ commune: str, dept: str, lat: num, lon: num });
const cable = refine(record({
  id: str, name: strOrNull, operator: strOrNull, path: value(isMultiPath), landings: list(landing), source: value((v) => isOneOf(v, SOURCES)),
  licence: value((v) => isOneOf(v, LICENCES)), outOfService: bool,
}), (v) => typeof v.source === 'string' && CABLE_LICENCE[v.source] === v.licence, 'licence de la source');
const zoneFields = {
  id: str, name: strOrNull, info: strOrNull, source: exactly('Shom'), licence: exactly('Licence ouverte 2.0'), polygons: value(isPolygons),
};
const cableZone = record({ ...zoneFields, cableCategory: nullable(value((v) => isOneOf(v, CATEGORIES))) });
const anchorageZone = record({ ...zoneFields, anchoringProhibited: bool, crossesCableZone: bool });

const FILE_SHAPE = shapeOf<SubseaCablesFile>(record({
  generatedAt: date, osmBase: date, sources: list(dataSource), cables: list(cable), cableZones: list(cableZone),
  anchorageZones: list(anchorageZone),
}));

export function isSubseaCablesFile(v: unknown): v is SubseaCablesFile {
  return FILE_SHAPE.is(v);
}

async function readCablesFile(): Promise<{ file: SubseaCablesFile | null; fileError: string | null }> {
  try {
    const json = await readHealthJsonShared(CABLES_FILE_URL);
    if (!FILE_SHAPE.is(json)) throw new Error(`fichier des câbles mal formé : ${describeProblems(FILE_SHAPE.problems(json))}`);
    return { file: json, fileError: null };
  } catch (err) {
    return { file: null, fileError: err instanceof Error ? err.message : 'erreur inconnue' };
  }
}

/** Ne rejette jamais : veille relue sous son cache, fichier des câbles lu une fois (gardé tant qu'il a été lu). */
export async function fetchCables(previous: CablesState | null, now: number = Date.now()): Promise<CablesState> {
  const [watch, file] = await Promise.all([
    loadSovereigntySlot(CABLES_WATCH_URL, CABLES_WATCH_TTL_MS, previous?.watch, now, WATCH_SHAPE, 'de la veille des câbles'),
    previous?.file ? Promise.resolve({ file: previous.file, fileError: null }) : readCablesFile(),
  ]);
  return { watch, ...file };
}

/** Fusion à l'écriture (S3) : la veille comme les autres sources ; un fichier lu n'est jamais remplacé par une lecture en échec. */
export function mergeCables(current: CablesState | null, incoming: CablesState): CablesState {
  const file = incoming.file ?? current?.file ?? null;
  return { watch: mergeSlot(current?.watch, incoming.watch), file, fileError: file ? null : incoming.fileError };
}

/** Panneau des sources : « Câbles et AIS », daté par le dernier message AIS en eaux françaises (S1). */
export function cablesStatus(state: CablesState, now: number): SovereigntyStatus {
  return sovereigntySlotStatus(state.watch, 'ais-cables', state.watch.data?.aisLastMessageAt ?? null, now);
}
