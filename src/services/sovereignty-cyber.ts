// src/services/sovereignty-cyber.ts : lecture client de la Vigilance cyber (spec 2026-10-04 souveraineté § 2.3 ; contrats § 3.3 ;
// amendement 7, O1, O3, O5, S12). Une route (/api/sovereignty/cyber), cinq sources datées chacune par sa donnée : CERT-FR (statut
// officiel des alertes, exploitation citée, rapports Menaces et incidents de l'ANSSI), CISA KEV, Ransomware.live (revendications
// agrégées), Have I Been Pwned (un compte et un lien, jamais un titre ni un domaine) et Cybermalveillance.gouv.fr. Garde de forme
// exacte élément par élément, lecture qui ne rejette jamais, fusion à l'écriture. Préfixe `Sov` : l'ancien type `CyberState`
// (src/services/cyber.ts) vit jusqu'à la tâche A17.
import type { CyberResponse } from '../types/index.ts';
import type { SovereigntySource } from './sovereignty-levels.ts';
import {
  isBool, isCount, isCountOrNull, isDate, isDateOrNull, isDay, isDayOrNull, isNumOrNull, isOneOf, isStr, isStrOrNull,
  isStringList, list, loadSovereigntySlot, mergeSlot, nullable, record, refine, shapeOf, sovereigntySlotStatus, value, type SourceSlot,
  type SovereigntyStatus,
} from './sovereignty-source.ts';

export const CYBER_URL = '/api/sovereignty/cyber';
/** Cache client : 10 min, sous la relève de 15 min (App.ts). */
export const CYBER_TTL_MS = 10 * 60_000;

export interface SovCyberState { cyber: SourceSlot<CyberResponse> }
export type CyberPart = 'certfr' | 'kev' | 'ransomware' | 'hibp' | 'cybermalveillance';

const STATUSES: ReadonlySet<string> = new Set(['en-cours', 'cloturee']);
const LANGS: ReadonlySet<string> = new Set(['fr', 'en']);
const FEEDS: ReadonlySet<string> = new Set(['alertes', 'actualites']);

const str = value(isStr);
const strOrNull = value(isStrOrNull);
const numOrNull = value(isNumOrNull);
const bool = value(isBool);
const count = value(isCount);
const date = value(isDate);
const dateOrNull = value(isDateOrNull);
const day = value(isDay);
const dayOrNull = value(isDayOrNull);
const strings = value(isStringList);

/** Élément CERT-FR (O1, O3) : statut officiel ou null (avis, ou statut non lu), exploitation citée telle quelle. */
const itemFields = {
  ref: str, kind: value((v) => v === 'alerte' || v === 'avis'), title: str, product: strOrNull, updatedMark: bool, url: str, firstVersion: day,
  lastVersion: dayOrNull, cves: strings, kevCves: strings, pageReadAt: dateOrNull, status: nullable(value((v) => isOneOf(v, STATUSES))),
  closedAt: dayOrNull, exploited: nullable(bool), exploitedQuote: strOrNull,
};
/** Alertes : genre « alerte » ; avis : genre « avis », jamais de statut (le CERT-FR n'en publie que pour les alertes). */
const alerte = refine(record(itemFields), (v) => v.kind === 'alerte', 'alerte attendue');
const avis = refine(record(itemFields), (v) => v.kind === 'avis' && v.status === null && v.closedAt === null, 'avis sans statut attendu');
const report = record({ ref: str, title: str, lang: value((v) => isOneOf(v, LANGS)), date: day, url: str });
const kevItem = record({
  cve: str, vendor: str, product: str, name: str, dateAdded: day, dueDate: dayOrNull, ransomware: bool, certfrRefs: strings,
});
const kevWeek = record({ weekStart: date, added: count, cited: count });
const ransomWeek = record({ weekStart: date, count });
const share = record({ label: str, count });
/** Revendications agrégées (V3) : comptes, jamais un nom de victime. */
const ransomware = nullable(record({
  lastModified: dateOrNull, checkedAt: dateOrNull, weeks: list(ransomWeek), weekCount: count, baselineWeekly: numOrNull, ratio: numOrNull,
  last30: count, baseline30: numOrNull, sectors30: list(share), groups30: list(share),
}));
/** Fuites publiées en .fr (O5) : un compte et un lien seulement. */
const hibp = nullable(record({ readAt: date, count, newestAddedDate: strOrNull, url: str }));
const entry = record({ feed: value((v) => isOneOf(v, FEEDS)), title: str, url: str, published: strOrNull, updated: strOrNull });

const CYBER_SHAPE = shapeOf<CyberResponse>(record({
  readAt: dateOrNull,
  certfr: record({ readAt: dateOrNull, alerts: list(alerte, 'ref'), avis: list(avis, 'ref'), reports: list(report, 'ref') }),
  kev: record({
    readAt: dateOrNull, catalogVersion: strOrNull, dateReleased: strOrNull, count: value(isCountOrNull), recent: list(kevItem, 'cve'),
    weeks: list(kevWeek),
  }),
  ransomware,
  hibp,
  cybermalveillance: nullable(record({ readAt: dateOrNull, entries: list(entry) })),
  errors: strings,
}));

/** Écarts à la forme de /api/sovereignty/cyber, nommés un par un ; liste vide : conforme. */
export function cyberResponseProblems(v: unknown): string[] {
  return CYBER_SHAPE.problems(v);
}

export function isCyberResponse(v: unknown): v is CyberResponse {
  return CYBER_SHAPE.is(v);
}

/** Ne rejette jamais : une lecture en échec porte `error` et garde les dernières données. */
export async function fetchCyber(previous: SovCyberState | null, now: number = Date.now()): Promise<SovCyberState> {
  return { cyber: await loadSovereigntySlot(CYBER_URL, CYBER_TTL_MS, previous?.cyber, now, CYBER_SHAPE, 'de la vigilance cyber') };
}

/** Fusion à l'écriture (S3) : une lecture en échec garde les données actuellement en mémoire. */
export function mergeCyber(current: SovCyberState | null, incoming: SovCyberState): SovCyberState {
  return { cyber: mergeSlot(current?.cyber, incoming.cyber) };
}

/** Ligne du panneau des sources de chaque partie : source du retard, préfixe des erreurs du serveur, date de la donnée (S1). */
interface PartLine {
  source: SovereigntySource;
  prefix: string;
  date: (c: CyberResponse) => string | null;
  /** Date de repli quand la source ne publie pas la sienne, avec sa note. */
  fallback?: { date: (c: CyberResponse) => string | null; note: string };
}

/** Fichier victims.json servi sans en-tête last-modified : daté par le relevé du serveur (`checkedAt`), et dit. */
export const RANSOMWARE_UNDATED_NOTE = 'fichier sans date de modification';

const PARTS: Readonly<Record<CyberPart, PartLine>> = {
  certfr: { source: 'certfr', prefix: 'CERT-FR', date: (c) => c.certfr.readAt },
  kev: { source: 'kev', prefix: 'CISA KEV', date: (c) => c.kev.readAt },
  ransomware: {
    source: 'ransomware', prefix: 'Ransomware.live', date: (c) => c.ransomware?.lastModified ?? null,
    fallback: { date: (c) => c.ransomware?.checkedAt ?? null, note: RANSOMWARE_UNDATED_NOTE },
  },
  hibp: { source: 'hibp', prefix: 'HIBP', date: (c) => c.hibp?.readAt ?? null },
  cybermalveillance: { source: 'cybermalveillance', prefix: 'Cybermalveillance', date: (c) => c.cybermalveillance?.readAt ?? null },
};

/** Préfixes des erreurs du serveur, une source chacun ; une erreur qui n'en porte aucun vaut pour les cinq lignes. */
const PREFIXES: readonly string[] = Object.values(PARTS).map((p) => p.prefix);

/**
 * Panneau des sources : « CERT-FR » (relevé des flux), « CISA KEV » (relevé du catalogue), « Ransomware.live » (date du fichier
 * publié, `lastModified` ; sans elle, date du relevé `checkedAt` et « fichier sans date de modification »), « Have I Been Pwned » et
 * « Cybermalveillance.gouv.fr » (relevé, `readAt`). Chaque ligne ne garde que les erreurs de sa source, plus celles qui n'en nomment
 * aucune (collecte interrompue, « Vigilance cyber : collecte en cours »).
 */
export function cyberStatus(state: SovCyberState, part: CyberPart, now: number): SovereigntyStatus {
  const p = PARTS[part];
  const data = state.cyber.data;
  const fallback = p.fallback && data ? { date: p.fallback.date(data), note: p.fallback.note } : undefined;
  return sovereigntySlotStatus(state.cyber, p.source, data ? p.date(data) : null, now, p.prefix, { parts: PREFIXES, fallback });
}
