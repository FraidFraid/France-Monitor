// src/services/sovereignty-cyber.ts : lecture client de la Vigilance cyber (spec 2026-10-04 souveraineté § 2.3 ; contrats § 3.3 ;
// amendement 7, O1, O3, O5, S12). Une route (/api/sovereignty/cyber), cinq sources datées chacune par sa donnée : CERT-FR (statut
// officiel des alertes, exploitation citée, rapports Menaces et incidents de l'ANSSI), CISA KEV, Ransomware.live (revendications
// agrégées), Have I Been Pwned (un compte et un lien, jamais un titre ni un domaine) et Cybermalveillance.gouv.fr. Garde de forme
// exacte élément par élément, lecture qui ne rejette jamais, fusion à l'écriture. Préfixe `Sov` : nom gardé depuis la coexistence
// avec l'ancien `CyberState` (retiré à la tâche A17).
import type { CyberResponse, CyberWatchResponse } from '../types/index.ts';
import type { SovereigntySource } from './sovereignty-levels.ts';
import {
  isBool, isCount, isCountOrNull, isDate, isDateOrNull, isDay, isDayOrNull, isNum, isNumOrNull, isOneOf, isStr, isStrOrNull,
  isStringList, list, loadSovereigntySlot, mergeSlot, nullable, record, refine, shapeOf, sovereigntySlotStatus, value, type SourceSlot,
  type SovereigntyStatus,
} from './sovereignty-source.ts';

export const CYBER_URL = '/api/sovereignty/cyber';
/** Cache client : 10 min, sous la relève de 15 min (App.ts). */
export const CYBER_TTL_MS = 10 * 60_000;

/** `watch` : veille cyber élargie (/api/sovereignty/cyber-watch, 18/10/2026), facultative : absente tant qu'elle n'a pas été lue. */
export interface SovCyberState { cyber: SourceSlot<CyberResponse>; watch?: SourceSlot<CyberWatchResponse> }
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

// ─── Veille cyber élargie (18/10/2026) ───

export const CYBER_WATCH_URL = '/api/sovereignty/cyber-watch';
const num = value(isNumOrNull);
const counted = list(record({ label: str, count }));
const radarAs = record({ asn: num, name: strOrNull, cc: strOrNull });
const series = list(record({ day, value: value(isNum) }));
const radar = nullable(record({
  readAt: date, dataUntil: str, l7: series, l3: series, l7Ratio: num, l3Ratio: num, industries: list(record({ label: str, pct: value(isNum) })),
  targetRank: num, targetShare: num,
  hijacks: list(record({ id: str, start: str, end: str, hijacker: radarAs, victims: list(radarAs), prefixes: count, confidence: num, ongoing: bool })),
  hijackCount: count,
  leaks: list(record({ id: str, start: str, leaker: radarAs, countries: strings, prefixes: num, finished: bool })),
  leakCount: count,
}));
const abuse = nullable(record({
  readAt: date,
  urlhaus: record({
    last30: count, online: count, threats: counted, asns: list(record({ asn: count, count, name: strOrNull })),
    weeks: list(record({ weeksAgo: count, count })), latest: list(record({ added: date, host: str, threat: str, asn: num })),
  }),
  feodo: record({
    total: count, fr: count, frOnline: count,
    servers: list(record({ ip: str, port: num, malware: strOrNull, asName: strOrNull, status: strOrNull, lastOnline: strOrNull })),
  }),
}));
const place = nullable(record({ dept: str, name: str, how: str, lon: num, lat: num }));
const ddosia = nullable(record({
  readAt: date,
  lastConfig: nullable(record({ id: str, at: date, targets: count, fr: count, tlds: counted })),
  hosts: list(record({ host: str, first: date, last: date, configs: count, kind: str, place }), 'host'),
  days: list(record({ day, configs: count, targets: count, fr: count, frHosts: strings })),
}));
const lookalikes = nullable(record({
  readAt: date, domains: list(record({ domain: str, brand: str, day })), perDay: list(record({ day, total: count, matched: count })),
}));
const cnil = nullable(record({
  readAt: date, fileDate: str, file: strOrNull, note: str, quarters: list(record({ q: str, count })), last4: count, hackingPct: num,
  externalPct: num, sectors: counted, origins: counted,
}));
const epss = nullable(record({ readAt: date, date: strOrNull, scores: list(record({ cve: str, epss: num, percentile: num })) }));
const euvd = nullable(record({
  readAt: date, total30: count, last7: count,
  items: list(record({ id: str, cve: strOrNull, vendor: strOrNull, product: strOrNull, score: num, exploitedSince: dayOrNull, published: dayOrNull })),
}));
const service = record({
  id: str, name: str, url: str, ok: bool, status: num, ms: num, error: strOrNull, downSince: dateOrNull, uptime24: num, medianMs: num,
  hours: list(num),
});

const TARGET_STATES: ReadonlySet<string> = new Set(['joignable', 'lent', 'injoignable']);
const target = record({
  host: str, ok: bool, status: num, ms: num, error: strOrNull, medianMs: num, state: value((v) => isOneOf(v, TARGET_STATES)), since: dateOrNull,
});

const CYBER_WATCH_SHAPE = shapeOf<CyberWatchResponse>(record({
  readAt: dateOrNull, radar, abuse, ddosia, lookalikes, cnil, epss, euvd,
  services: nullable(record({ readAt: date, items: list(service, 'id') })),
  targets: nullable(record({ readAt: date, items: list(target, 'host') })), errors: strings,
}));

/** Écarts à la forme de /api/sovereignty/cyber-watch, nommés un par un ; liste vide : conforme. */
export function cyberWatchProblems(v: unknown): string[] {
  return CYBER_WATCH_SHAPE.problems(v);
}

/** Ne rejette jamais : une lecture en échec porte `error` et garde les dernières données. */
export async function fetchCyber(previous: SovCyberState | null, now: number = Date.now()): Promise<SovCyberState> {
  const [cyber, watch] = await Promise.all([
    loadSovereigntySlot(CYBER_URL, CYBER_TTL_MS, previous?.cyber, now, CYBER_SHAPE, 'de la vigilance cyber'),
    loadSovereigntySlot(CYBER_WATCH_URL, CYBER_TTL_MS, previous?.watch, now, CYBER_WATCH_SHAPE, 'de la veille cyber'),
  ]);
  return { cyber, watch };
}

/** Fusion à l'écriture (S3) : une lecture en échec garde les données actuellement en mémoire. */
export function mergeCyber(current: SovCyberState | null, incoming: SovCyberState): SovCyberState {
  const watch = incoming.watch ? mergeSlot(current?.watch, incoming.watch) : current?.watch;
  return { cyber: mergeSlot(current?.cyber, incoming.cyber), ...(watch ? { watch } : {}) };
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
