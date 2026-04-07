/**
 * nuclear-rte.ts — Layer 1 : RTE OAuth2 Unavailability API
 *
 * Récupère les indisponibilités de production nucléaire depuis l'API
 * RTE Open Data via le Vercel function /api/nuclear/rte-unavailability.
 *
 * Temporalité : QUASI TEMPS RÉEL (cache applicatif 15 min)
 */

import type { NuclearUnavailability, ReactorAvailabilityStatus } from '../types/index.ts';
import { NUCLEAR_PLANTS, NUCLEAR_UNITS } from '../config/infrastructure.ts';
import { Watchdog } from './watchdog.ts';

// ── Watchdog registration ──
Watchdog.register('nuclear-rte', {
    label: 'Nucléaire RTE',
    staleAfterMs: 15 * 60_000,
    detail: 'RTE Open Data · indisponibilités de production · OAuth2',
});

const API_URL = import.meta.env.PROD
  ? '/api/nuclear/rte-unavailability'
  : '/api/nuclear/rte-unavailability'; // Vite proxy same path

const CACHE_TTL_MS = 15 * 60_000;
let _cache: { items: NuclearUnavailability[]; available: boolean; fetchedAt: number } | null = null;

export interface NuclearRTEResult {
  items: NuclearUnavailability[];
  /** true si l'API a répondu avec succès, même si 0 indisponibilités actives */
  available: boolean;
  /** Date du dernier fetch réussi, pour calculer la fraîcheur */
  fetchedAt?: Date;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retourne les indisponibilités nucléaires actives depuis RTE.
 * `available: false` uniquement si l'API est réellement inaccessible.
 * Un tableau vide avec `available: true` = toutes les tranches disponibles.
 */
export async function fetchNuclearUnavailabilities(): Promise<NuclearRTEResult> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return { items: _cache.items, available: _cache.available, fetchedAt: new Date(_cache.fetchedAt) };
  }

  Watchdog.report('nuclear-rte', { type: 'loading' });
  const t0 = Date.now();

  try {
    const resp = await fetch(API_URL, { signal: AbortSignal.timeout(20_000) });

    if (!resp.ok) {
      console.warn('[nuclear-rte] HTTP error:', resp.status);
      Watchdog.report('nuclear-rte', { type: 'failure', error: `HTTP ${resp.status}`, isFallback: !!_cache });
      // Servir le cache périmé si disponible (stale fallback)
      if (_cache) return { items: _cache.items, available: true, fetchedAt: new Date(_cache.fetchedAt) };
      return { items: [], available: false };
    }

    const json = (await resp.json()) as {
      available?: boolean;
      items?: unknown[];
      error?: string;
    };

    if (json.available === false) {
      console.warn('[nuclear-rte] API reported unavailable:', json.error);
      Watchdog.report('nuclear-rte', { type: 'failure', error: json.error ?? 'API indisponible', isFallback: !!_cache });
      if (_cache) return { items: _cache.items, available: true, fetchedAt: new Date(_cache.fetchedAt) };
      return { items: [], available: false };
    }

    const rawItems = Array.isArray(json.items) ? json.items : [];
    const items = rawItems.map(normalizeItem).filter((u): u is NuclearUnavailability => u !== null);
    const now = Date.now();
    _cache = { items, available: true, fetchedAt: now };
    Watchdog.report('nuclear-rte', { type: 'success', responseTimeMs: Date.now() - t0 });
    return { items, available: true, fetchedAt: new Date(now) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[nuclear-rte] Fetch failed:', err);
    Watchdog.report('nuclear-rte', { type: 'failure', error: msg, isFallback: !!_cache });
    if (_cache) return { items: _cache.items, available: true, fetchedAt: new Date(_cache.fetchedAt) };
    return { items: [], available: false };
  }
}

export function invalidateNuclearRTECache(): void {
  _cache = null;
}

/**
 * Pour un nom de centrale, retourne le statut le plus grave parmi ses tranches actives.
 * Utilisé pour colorier la carte.
 */
export function getPlantWorstStatus(
  plantName: string,
  unavailabilities: NuclearUnavailability[],
): ReactorAvailabilityStatus {
  const norm = normalizeText(plantName);
  const now = Date.now();

  const active = unavailabilities.filter(
    (u) =>
      normalizeText(u.plantName).includes(norm) &&
      u.startDate.getTime() <= now &&
      (u.endDate === null || u.endDate.getTime() >= now),
  );

  if (active.length === 0) return 'AVAILABLE';

  const priority: ReactorAvailabilityStatus[] = [
    'OUTAGE_UNPLANNED',
    'OUTAGE_PLANNED',
    'REDUCED',
    'AVAILABLE',
    'UNKNOWN',
  ];

  for (const p of priority) {
    if (active.some((u) => u.status === p)) return p;
  }
  return 'UNKNOWN';
}

/**
 * Construit une map plantName → couleur CSS pour la carte.
 */
export function buildNuclearColorMap(
  unavailabilities: NuclearUnavailability[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const plant of NUCLEAR_PLANTS) {
    if (plant.status === 'shutdown') continue;
    const status = getPlantWorstStatus(plant.name, unavailabilities);
    map[plant.name] = NUCLEAR_STATUS_COLORS[status];
  }
  return map;
}

// ── Color map ─────────────────────────────────────────────────────────────────

export const NUCLEAR_STATUS_COLORS: Record<ReactorAvailabilityStatus, string> = {
  AVAILABLE: '#2ECC71',
  REDUCED: '#F59E0B',
  OUTAGE_PLANNED: '#7B8CDE',
  OUTAGE_UNPLANNED: '#E74C3C',
  UNKNOWN: '#6B7280',
};

/** Couleur pour un signal REMIT non confirmé par RTE */
export const NUCLEAR_REMIT_UNCONFIRMED_COLOR = '#111827';

// ── Normalizer ────────────────────────────────────────────────────────────────

function normalizeItem(raw: unknown): NuclearUnavailability | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // ── Payload v7 (champs observés en production) ────────────────────────────
  // affected_asset_or_unit_name           → nom de la tranche
  // affected_asset_or_unit_installed_capacity → puissance installée MW
  // values[].available_capacity           → puissance disponible MW
  // identifier                            → id unique
  // publication_date                      → updatedAt
  // fuel_type                             → "NUCLEAR" pour filtrage
  //
  // Fallbacks v4/v5 conservés pour rétrocompatibilité.
  const unitName = String(
    r['affected_asset_or_unit_name'] ??
    (r['unit'] as Record<string, unknown> | undefined)?.['name'] ??
    r['asset_name'] ??
    r['unit_name'] ??
    '',
  ).trim();

  if (!unitName) return null;
  const ref = findNuclearUnitReference(unitName);
  if (!ref) return null;
  const plantName = ref.plantName;

  const nominalPowerMW = toNumber(
    r['affected_asset_or_unit_installed_capacity'] ??
    r['installed_capacity'] ??
    r['nominal_capacity'] ??
    ref.nominalPowerMW,
  );

  // v7 : la capacité disponible est dans le premier élément du tableau values[]
  const values = Array.isArray(r['values']) ? r['values'] as Record<string, unknown>[] : [];
  const availablePowerMW = values.length > 0
    ? toNumber(
        values[0]['available_capacity'] ??
        (values[0]['unavailable_capacity'] != null
          ? nominalPowerMW - toNumber(values[0]['unavailable_capacity'])
          : nominalPowerMW),
      )
    : toNumber(r['available_capacity'] ?? nominalPowerMW);

  const startDate = parseDate(
    (values[0]?.['start_date'] as string | undefined) ??
    (r['start_date'] as string | undefined),
  );
  const endDate = (() => {
    const s = (values[0]?.['end_date'] as string | undefined) ?? (r['end_date'] as string | undefined);
    return s ? parseDate(s) : null;
  })();

  if (!startDate) return null;

  const rawType = String(r['unavailability_type'] ?? r['type'] ?? '').toUpperCase();
  const type: NuclearUnavailability['type'] =
    rawType.includes('FORCED') || rawType.includes('UNPLANNED') ? 'UNPLANNED'
    : rawType.includes('FORCE_MAJEURE') ? 'FORCE_MAJEURE'
    : 'PLANNED';

  const status = deriveStatus(nominalPowerMW, availablePowerMW, type);

  return {
    id: String(r['identifier'] ?? r['id'] ?? r['eic_code'] ?? unitName + '-' + startDate.toISOString()),
    plantName,
    unitName: ref.unitName,
    nominalPowerMW,
    availablePowerMW,
    status,
    startDate,
    endDate,
    type,
    updatedAt: parseDate(
      (r['publication_date'] as string | undefined) ??
      (r['creation_date'] as string | undefined) ??
      (r['updated_date'] as string | undefined),
    ) ?? new Date(),
  };
}

function deriveStatus(
  nominal: number,
  available: number,
  type: NuclearUnavailability['type'],
): ReactorAvailabilityStatus {
  if (nominal <= 0) return 'UNKNOWN';
  const ratio = available / nominal;
  if (ratio >= 0.95) return 'AVAILABLE';
  if (ratio > 0) return type === 'UNPLANNED' ? 'OUTAGE_UNPLANNED' : 'REDUCED';
  return type === 'UNPLANNED' ? 'OUTAGE_UNPLANNED' : 'OUTAGE_PLANNED';
}

function findNuclearUnitReference(unitName: string) {
  const norm = normalizeText(unitName);
  return NUCLEAR_UNITS.find((unit) => {
    if (normalizeText(unit.unitName) === norm) return true;
    return (unit.aliases ?? []).some((alias) => normalizeText(alias) === norm);
  }) ?? null;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
