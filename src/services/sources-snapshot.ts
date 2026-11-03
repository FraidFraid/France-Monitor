// src/services/sources-snapshot.ts : dernier relevé de l'état des sources par le tableau de bord, gardé dans le navigateur
// (03/11/2026). L'état des flux (à jour, en erreur, fraîcheur) ne se mesure que pendant que la carte tourne : la page séparée
// Sources & qualité (/sources-quality) ne charge aucune donnée et affichait « 0 source active ». Elle lit désormais ce relevé,
// daté ; trop vieux ou absent, elle dit que l'état n'a pas été mesuré au lieu d'afficher des zéros.
import type { DataSourceStatus } from '../types/index.ts';

export const SOURCES_SNAPSHOT_KEY = 'fm.sources.snapshot.v1';
/** Au-delà de 2 h, le relevé ne dit plus l'état du moment : la page le tient pour absent. */
export const SOURCES_SNAPSHOT_MAX_AGE_MS = 2 * 3_600_000;

export interface SourcesSnapshot {
  /** Instant du relevé (ms). */
  at: number;
  sources: DataSourceStatus[];
}

const STATUSES: ReadonlySet<string> = new Set(['ok', 'stale', 'error', 'loading']);
const DATE_FIELDS = ['lastUpdate', 'lastSuccess', 'lastError'] as const;

const toDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** Relevé sérialisé (dates en ISO). */
export function serializeSourcesSnapshot(sources: readonly DataSourceStatus[], at: number): string {
  return JSON.stringify({ at, sources });
}

/** Relevé relu : null s'il est absent, illisible ou plus vieux que `maxAgeMs`. Dates rendues en Date. */
export function parseSourcesSnapshot(raw: string | null, now: number, maxAgeMs: number = SOURCES_SNAPSHOT_MAX_AGE_MS): SourcesSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { at, sources } = parsed as { at?: unknown; sources?: unknown };
  if (typeof at !== 'number' || !Number.isFinite(at) || now - at > maxAgeMs || at - now > 60_000 || !Array.isArray(sources)) return null;
  const rows: DataSourceStatus[] = [];
  for (const s of sources) {
    if (typeof s !== 'object' || s === null) continue;
    const r = s as Record<string, unknown>;
    if (typeof r.name !== 'string' || typeof r.status !== 'string' || !STATUSES.has(r.status)) continue;
    const row = { ...r } as unknown as DataSourceStatus;
    for (const f of DATE_FIELDS) if (f in r) (row as unknown as Record<string, unknown>)[f] = toDate(r[f]);
    if (!('lastUpdate' in r)) row.lastUpdate = null;
    rows.push(row);
  }
  return rows.length > 0 ? { at, sources: rows } : null;
}

/** Relevé enregistré ; stockage absent ou refusé : rien (la page dira « non mesuré »). */
export function saveSourcesSnapshot(storage: Pick<Storage, 'setItem'> | null, sources: readonly DataSourceStatus[], at: number): void {
  if (!storage || sources.length === 0) return;
  try {
    storage.setItem(SOURCES_SNAPSHOT_KEY, serializeSourcesSnapshot(sources, at));
  } catch {
    // stockage plein ou refusé
  }
}

export function readSourcesSnapshot(storage: Pick<Storage, 'getItem'> | null, now: number): SourcesSnapshot | null {
  try {
    return parseSourcesSnapshot(storage?.getItem(SOURCES_SNAPSHOT_KEY) ?? null, now);
  } catch {
    return null;
  }
}
