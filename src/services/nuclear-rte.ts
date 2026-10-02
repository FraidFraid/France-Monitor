/**
 * nuclear-rte.ts — Layer 1 : RTE OAuth2 Unavailability API
 *
 * Récupère les indisponibilités de production nucléaire depuis l'API
 * RTE Open Data via le Vercel function /api/nuclear/rte-unavailability.
 *
 * Temporalité : QUASI TEMPS RÉEL (cache applicatif 15 min)
 */

import type { NuclearUnavailability, ReactorAvailabilityStatus } from '../types/index.ts';
import type { LegendItem } from '../components/MapLegend.ts';
import { NUCLEAR_PLANTS, NUCLEAR_UNITS } from '../config/infrastructure.ts';
import { Watchdog } from './watchdog.ts';
import { dedupe } from '../utils/inflight.ts';
import { readPersisted, writePersisted } from '../utils/persistentCache.ts';
import { levelHex } from './vigilance.ts';

// ── Watchdog registration ──
Watchdog.register('nuclear-rte', {
    label: 'Nucléaire RTE',
    staleAfterMs: 15 * 60_000,
    detail: 'RTE Open Data · indisponibilités de production · OAuth2',
});

const API_URL = import.meta.env.PROD
  ? '/api/nuclear/rte-unavailability'
  : '/api/nuclear/rte-unavailability'; // Vite proxy same path

// Cache client court : l'âge affiché part de la lecture serveur (≤ 10 min) et doit rester sous le seuil « en retard » (30 min).
const CACHE_TTL_MS = 5 * 60_000;
/** `fetchedAt` : instant de remplissage côté client (durée de vie du cache) ; `dataAt` : heure de lecture RTE par le serveur. */
let _cache: { items: NuclearUnavailability[]; available: boolean; fetchedAt: number; dataAt: number } | null = null;

const PERSIST_TTL_MS = 10 * 60_000;
const PERSIST_KEY = 'nuclear-rte-unavailabilities-v2';

interface PersistedNuclear { items: NuclearUnavailability[]; dataAt: number }

function isPersistedNuclear(value: unknown): value is PersistedNuclear {
    return !!value && typeof value === 'object' && Array.isArray((value as PersistedNuclear).items)
        && Number.isFinite((value as PersistedNuclear).dataAt);
}

/** JSON.parse ne revit pas les `Date` — reconvertir après lecture localStorage. */
function reviveNuclearDates(items: NuclearUnavailability[]): NuclearUnavailability[] {
    return items.map((item) => ({
        ...item,
        startDate: new Date(item.startDate),
        endDate: item.endDate ? new Date(item.endDate) : null,
        updatedAt: new Date(item.updatedAt),
    }));
}

export interface NuclearRTEResult {
  items: NuclearUnavailability[];
  /** true si l'API a répondu avec succès, même si 0 indisponibilités actives */
  available: boolean;
  /** Heure de lecture RTE par le serveur (ou des données en cache si RTE a échoué), pour la fraîcheur */
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
    return { items: _cache.items, available: _cache.available, fetchedAt: new Date(_cache.dataAt) };
  }

  // Rechargement de page : peindre la dernière disponibilité connue (< 10 min) avant réseau.
  const persisted = readPersisted<PersistedNuclear>(PERSIST_KEY, PERSIST_TTL_MS, isPersistedNuclear);
  if (persisted) {
    const items = reviveNuclearDates(persisted.items);
    _cache = { items, available: true, fetchedAt: Date.now(), dataAt: persisted.dataAt };
    return { items, available: true, fetchedAt: new Date(persisted.dataAt) };
  }

  Watchdog.report('nuclear-rte', { type: 'loading' });
  const t0 = Date.now();

  try {
    // Single-flight : évite un doublon si plusieurs consommateurs (panneau +
    // couche carte) réclament la disponibilité nucléaire simultanément.
    const json = await dedupe(API_URL, async () => {
      const resp = await fetch(API_URL, { signal: AbortSignal.timeout(20_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return (await resp.json()) as { available?: boolean; items?: unknown[]; error?: string; fetchedAt?: string };
    });

    if (json.available === false) {
      console.warn('[nuclear-rte] API reported unavailable:', json.error);
      Watchdog.report('nuclear-rte', { type: 'failure', error: json.error ?? 'API indisponible', isFallback: !!_cache });
      if (_cache) return { items: _cache.items, available: true, fetchedAt: new Date(_cache.dataAt) };
      return { items: [], available: false };
    }

    const rawItems = Array.isArray(json.items) ? json.items : [];
    const items = normalizeNuclearItems(rawItems, Date.now());
    const now = Date.now();
    const serverAt = json.fetchedAt ? Date.parse(json.fetchedAt) : NaN;
    const dataAt = Number.isFinite(serverAt) ? serverAt : now;
    _cache = { items, available: true, fetchedAt: now, dataAt };
    writePersisted(PERSIST_KEY, { items, dataAt });
    Watchdog.report('nuclear-rte', { type: 'success', responseTimeMs: Date.now() - t0 });
    return { items, available: true, fetchedAt: new Date(dataAt) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[nuclear-rte] Fetch failed:', err);
    Watchdog.report('nuclear-rte', { type: 'failure', error: msg, isFallback: !!_cache });
    if (_cache) return { items: _cache.items, available: true, fetchedAt: new Date(_cache.dataAt) };
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
  nowMs: number = Date.now(),
): ReactorAvailabilityStatus {
  const norm = normalizeText(plantName);
  const now = nowMs;

  const active = unavailabilities.filter(
    (u) =>
      normalizeText(u.plantName).includes(norm) &&
      u.startDate.getTime() <= now &&
      (u.endDate === null || u.endDate.getTime() > now),
  );

  if (active.length === 0) return 'AVAILABLE';

  const priority: ReactorAvailabilityStatus[] = [
    'OUTAGE_UNPLANNED',
    'REDUCED',
    'OUTAGE_PLANNED',
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
  AVAILABLE: levelHex('vert'),
  REDUCED: levelHex('jaune'),
  OUTAGE_PLANNED: '#6e6e80',
  OUTAGE_UNPLANNED: levelHex('orange'),
  UNKNOWN: '#3a3a4e',
};

/** Éléments de légende pour la couche nucléaire, construits à partir des couleurs de statut. */
export const NUCLEAR_LEGEND_ITEMS: LegendItem[] = [
  { id: 'nuc-available', label: 'Disponible', color: NUCLEAR_STATUS_COLORS.AVAILABLE, shape: 'circle' },
  { id: 'nuc-reduced', label: 'Puissance réduite', color: NUCLEAR_STATUS_COLORS.REDUCED, shape: 'circle' },
  { id: 'nuc-planned', label: 'Arrêt programmé', color: NUCLEAR_STATUS_COLORS.OUTAGE_PLANNED, shape: 'circle' },
  { id: 'nuc-unplanned', label: 'Arrêt fortuit', color: NUCLEAR_STATUS_COLORS.OUTAGE_UNPLANNED, shape: 'circle' },
  { id: 'nuc-unknown', label: 'Inconnu', color: NUCLEAR_STATUS_COLORS.UNKNOWN, shape: 'circle' },
];

/** Couleur pour un signal REMIT non confirmé par RTE */
export const NUCLEAR_REMIT_UNCONFIRMED_COLOR = '#111827';

// ── Normalizer ────────────────────────────────────────────────────────────────

/**
 * Normalise la réponse RTE : ignore le non nucléaire et les messages annulés (DISMISSED),
 * ne garde que la version la plus récente de chaque identifiant (filet de sécurité en plus de
 * last_version=true), et écarte les indisponibilités dont la dernière version est INACTIVE
 * (terminées). `now` choisit le segment values[] en cours.
 */
export function normalizeNuclearItems(rawItems: unknown[], now: number): NuclearUnavailability[] {
  const latest = new Map<string, NuclearUnavailability>();
  for (const raw of rawItems) {
    const u = normalizeItem(raw, now);
    if (!u) continue;
    const prev = latest.get(u.id);
    if (!prev || (u.version ?? 0) >= (prev.version ?? 0)) latest.set(u.id, u);
  }
  return [...latest.values()].filter((u) => u.eventStatus !== 'INACTIVE');
}

function normalizeItem(raw: unknown, now: number): NuclearUnavailability | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const eventStatus = String(r['event_status'] ?? 'ACTIVE').toUpperCase();
  if (eventStatus === 'DISMISSED') return null;
  const fuel = r['fuel_type'];
  if (fuel != null && String(fuel).toUpperCase() !== 'NUCLEAR') return null;

  // Champs v7 : affected_asset_or_unit_name, affected_asset_or_unit_installed_capacity,
  // values[].available_capacity, identifier, version, publication_date, fuel_type, event_status.
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

  // Segment values[] qui couvre maintenant, à défaut le premier.
  const values = Array.isArray(r['values']) ? r['values'] as Record<string, unknown>[] : [];
  const seg = values.find((v) => {
    const a = parseDate(v['start_date'] as string | undefined);
    const b = parseDate(v['end_date'] as string | undefined);
    return a !== null && a.getTime() <= now && (b === null || b.getTime() > now);
  }) ?? values[0];
  const availablePowerMW = seg
    ? toNumber(
        seg['available_capacity'] ??
        (seg['unavailable_capacity'] != null
          ? nominalPowerMW - toNumber(seg['unavailable_capacity'])
          : nominalPowerMW),
      )
    : toNumber(r['available_capacity'] ?? nominalPowerMW);

  const startDate = parseDate(
    (r['start_date'] as string | undefined) ??
    (values[0]?.['start_date'] as string | undefined),
  );
  const endDate = (() => {
    const s = (seg?.['end_date'] as string | undefined) ?? (r['end_date'] as string | undefined);
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
    version: toNumber(r['version']),
    eventStatus,
  };
}

function deriveStatus(
  nominal: number,
  available: number,
  type: NuclearUnavailability['type'],
): ReactorAvailabilityStatus {
  if (nominal <= 0) return 'UNKNOWN';
  const ratio = available / nominal;
  if (ratio >= 1) return 'AVAILABLE';
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
