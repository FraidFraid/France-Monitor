// src/services/news-events.ts — événements consolidés côté serveur (/api/events*).
// Les articles sont regroupés en événements par le cron d'ingestion ; ce service ne fait
// que lire, valider et ordonner. Disjoncteur : 3 échecs consécutifs → 5 min sans appel ;
// chaque appel est abandonné au bout de 8 s.

import type {
  BriefEventInput,
  ChangeDigestItem,
  IntelEventsState,
  IntelVisitAnchor,
  NewsEvent,
  NewsEventArticle,
  NewsEventChange,
  NewsEventChangeKind,
  NewsEventDetail,
  NewsEventStatus,
  ThreatLevel,
} from '../types/index.ts';

const FIVE_MIN_MS = 5 * 60 * 1000;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const SEVERITIES: readonly ThreatLevel[] = ['critical', 'high', 'medium', 'low', 'info'];
const STATUSES: readonly NewsEventStatus[] = ['active', 'cooling', 'closed'];
const KINDS: readonly NewsEventChangeKind[] = ['created', 'escalated', 'deescalated', 'corroborated', 'reopened', 'cooling', 'closed'];

export const SEVERITY_RANK: Record<ThreatLevel, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Importance d'un type de changement dans le fil (le plus haut d'abord). */
const KIND_RANK: Record<NewsEventChangeKind, number> = {
  escalated: 6, created: 5, reopened: 4, corroborated: 3, deescalated: 2, closed: 1, cooling: 0,
};

let consecutiveFailures = 0;
let cooldownUntil = 0;

/** Arrondi aux 5 min inférieures : une même URL par tranche de 5 min → cache CDN partagé. */
export function roundDownTo5Min(ms: number): number {
  return Math.floor(ms / FIVE_MIN_MS) * FIVE_MIN_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

export function parseNewsEvent(value: unknown): NewsEvent | null {
  if (!isRecord(value)) return null;
  const id = num(value.id);
  const title = str(value.title);
  const severity = oneOf(value.severity, SEVERITIES);
  const status = oneOf(value.status, STATUSES);
  const firstSeen = str(value.firstSeen);
  const lastSeen = str(value.lastSeen);
  if (id === null || title === null || severity === null || status === null || firstSeen === null || lastSeen === null) return null;
  return {
    id,
    evidenceId: `E${id}`,
    title,
    category: str(value.category) ?? 'general',
    severity,
    status,
    firstSeen,
    lastSeen,
    articleCount: num(value.articleCount) ?? 1,
    sourceCount: num(value.sourceCount) ?? 1,
    independentCount: num(value.independentCount) ?? 1,
    sourceNames: Array.isArray(value.sourceNames) ? value.sourceNames.filter((s): s is string => typeof s === 'string') : [],
    lat: num(value.lat),
    lon: num(value.lon),
  };
}

function parseChange(value: unknown): NewsEventChange | null {
  if (!isRecord(value)) return null;
  const at = str(value.at);
  const kind = oneOf(value.kind, KINDS);
  const event = parseNewsEvent(value.event);
  if (at === null || kind === null || event === null) return null;
  return { at, kind, from: str(value.from), to: str(value.to), event };
}

async function getJson(url: string): Promise<unknown> {
  if (Date.now() < cooldownUntil) throw new Error('news-events: disjoncteur ouvert');
  // Délai borné : le brief attend ces données ; une base qui cale ne doit pas le retenir.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('news-events: délai dépassé')), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`news-events: HTTP ${res.status}`);
    const body: unknown = await res.json();
    consecutiveFailures = 0;
    return body;
  } catch (err) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
      consecutiveFailures = 0;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Réarme le disjoncteur (tests). */
export function resetNewsEventsCircuit(): void {
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

export async function fetchNewsEvents(): Promise<NewsEvent[]> {
  const body = await getJson('/api/events?status=active,cooling&limit=40');
  if (!isRecord(body) || !Array.isArray(body.events)) return [];
  return body.events.map(parseNewsEvent).filter((e): e is NewsEvent => e !== null);
}

export async function fetchEventChanges(since: number): Promise<{ changes: NewsEventChange[]; totals: Partial<Record<NewsEventChangeKind, number>> }> {
  const body = await getJson(`/api/events/changes?since=${new Date(roundDownTo5Min(since)).toISOString()}`);
  if (!isRecord(body)) return { changes: [], totals: {} };
  const changes = Array.isArray(body.changes) ? body.changes.map(parseChange).filter((c): c is NewsEventChange => c !== null) : [];
  const totals: Partial<Record<NewsEventChangeKind, number>> = {};
  if (isRecord(body.totals)) {
    for (const kind of KINDS) {
      const n = num(body.totals[kind]);
      if (n !== null) totals[kind] = n;
    }
  }
  return { changes, totals };
}

export async function fetchEventDetail(id: number): Promise<NewsEventDetail | null> {
  let body: unknown;
  try {
    body = await getJson(`/api/events/detail?id=${id}`);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  const event = parseNewsEvent(body.event);
  if (!event) return null;
  const articles: NewsEventArticle[] = Array.isArray(body.articles)
    ? body.articles.flatMap((a): NewsEventArticle[] => {
      if (!isRecord(a)) return [];
      const articleId = num(a.id);
      const title = str(a.title);
      const link = str(a.link);
      if (articleId === null || title === null || link === null) return [];
      return [{ id: articleId, title, link, feedName: str(a.feedName), publishedAt: str(a.publishedAt) }];
    })
    : [];
  const log: NewsEventDetail['log'] = Array.isArray(body.log)
    ? body.log.flatMap((l): NewsEventDetail['log'] => {
      if (!isRecord(l)) return [];
      const at = str(l.at);
      const kind = oneOf(l.kind, KINDS);
      return at === null || kind === null ? [] : [{ at, kind, from: str(l.from), to: str(l.to) }];
    })
    : [];
  return { event, articles, log };
}

/**
 * Événements transmis au brief : ouverts, et soit graves (≥ medium) soit corroborés
 * (≥ 2 groupes indépendants) ; gravité, corroboration puis fraîcheur ; 10 au plus.
 */
export function selectBriefEvents(events: NewsEvent[], max = 10): BriefEventInput[] {
  return events
    .filter((e) => e.status !== 'closed' && (SEVERITY_RANK[e.severity] >= SEVERITY_RANK.medium || e.independentCount >= 2))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      || b.independentCount - a.independentCount
      || Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, max)
    .map((e) => ({
      id: e.evidenceId,
      title: e.title,
      category: e.category,
      severity: e.severity,
      sources: e.sourceNames.slice(0, 5),
      sourceCount: e.sourceCount,
      independentCount: e.independentCount,
      lastSeen: e.lastSeen,
      status: e.status,
    }));
}

/**
 * Regroupe les changements par événement (le serveur les renvoie du plus récent au plus
 * ancien) : un événement aggravé puis corroboré n'occupe qu'une ligne.
 */
export function digestChanges(changes: NewsEventChange[]): ChangeDigestItem[] {
  const byEvent = new Map<number, ChangeDigestItem>();
  for (const change of changes) {
    let item = byEvent.get(change.event.id);
    if (!item) {
      item = { event: change.event, kinds: [], latestAt: change.at, severityFrom: null, independentFrom: null };
      byEvent.set(change.event.id, item);
    }
    if (!item.kinds.includes(change.kind)) item.kinds.push(change.kind);
    // Parcours du récent vers l'ancien : la dernière valeur lue est la plus ancienne.
    if (change.kind === 'escalated') item.severityFrom = change.from;
    if (change.kind === 'corroborated' && change.from !== null) item.independentFrom = Number(change.from);
  }
  const top = (item: ChangeDigestItem): number => Math.max(...item.kinds.map((k) => KIND_RANK[k]));
  for (const item of byEvent.values()) item.kinds.sort((a, b) => KIND_RANK[b] - KIND_RANK[a]);
  return [...byEvent.values()].sort((a, b) => top(b) - top(a)
    || SEVERITY_RANK[b.event.severity] - SEVERITY_RANK[a.event.severity]
    || Date.parse(b.latestAt) - Date.parse(a.latestAt));
}

/** Charge événements et fil de changements ; un échec est signalé, jamais masqué. */
export async function loadIntelEventsState(anchor: IntelVisitAnchor, now = Date.now()): Promise<IntelEventsState> {
  const [events, changes] = await Promise.allSettled([fetchNewsEvents(), fetchEventChanges(anchor.since)]);
  return {
    events: events.status === 'fulfilled' ? events.value : [],
    digest: changes.status === 'fulfilled' ? digestChanges(changes.value.changes) : [],
    totals: changes.status === 'fulfilled' ? changes.value.totals : {},
    anchor,
    fetchedAt: now,
    unavailable: events.status === 'rejected' || changes.status === 'rejected',
  };
}
