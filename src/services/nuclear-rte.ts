/**
 * nuclear-rte.ts — Layer 1 : RTE OAuth2 Unavailability API
 *
 * Récupère les indisponibilités de production nucléaire depuis l'API
 * RTE Open Data via le Vercel function /api/nuclear/rte-unavailability.
 *
 * Temporalité : QUASI TEMPS RÉEL (cache applicatif 15 min)
 */

import type { NuclearUnavailability, ReactorAvailabilityStatus } from '../types/index.ts';
import { NUCLEAR_PLANTS } from '../config/infrastructure.ts';

const API_URL = import.meta.env.PROD
  ? '/api/nuclear/rte-unavailability'
  : '/api/nuclear/rte-unavailability'; // Vite proxy same path

const CACHE_TTL_MS = 15 * 60_000;
let _cache: { items: NuclearUnavailability[]; fetchedAt: number } | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retourne les indisponibilités nucléaires actives depuis RTE.
 * Retourne [] si l'API est indisponible (pas de données fictives).
 */
export async function fetchNuclearUnavailabilities(): Promise<NuclearUnavailability[]> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.items;
  }

  try {
    const resp = await fetch(API_URL, { signal: AbortSignal.timeout(20_000) });

    if (!resp.ok) {
      console.warn('[nuclear-rte] HTTP error:', resp.status);
      return [];
    }

    const json = (await resp.json()) as {
      available?: boolean;
      items?: unknown[];
      error?: string;
    };

    if (!json.available || !Array.isArray(json.items)) {
      console.warn('[nuclear-rte] Unavailable or malformed response:', json.error ?? 'no items');
      return [];
    }

    const items = json.items.map(normalizeItem).filter((u): u is NuclearUnavailability => u !== null);
    _cache = { items, fetchedAt: Date.now() };
    return items;
  } catch (err) {
    console.warn('[nuclear-rte] Fetch failed:', err);
    return [];
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

  // L'API RTE peut renvoyer unit.name ou asset_name selon la version
  const unit = (r['unit'] as Record<string, unknown> | undefined) ?? {};
  const unitName  = String(unit['name'] ?? r['asset_name'] ?? r['unit_name'] ?? '').trim();
  const plantName = derivePlantName(unitName);
  if (!plantName) return null;

  const nominalPowerMW   = toNumber(r['installed_capacity'] ?? r['nominal_capacity'] ?? 0);
  const availablePowerMW = toNumber(r['available_capacity'] ?? 0);
  const startDate        = parseDate(r['start_date'] as string | undefined);
  const endDate          = r['end_date'] ? parseDate(r['end_date'] as string) : null;

  if (!startDate) return null;

  const rawType   = String(r['unavailability_type'] ?? r['type'] ?? '').toUpperCase();
  const type: NuclearUnavailability['type'] =
    rawType.includes('FORCED') || rawType.includes('UNPLANNED') ? 'UNPLANNED'
    : rawType.includes('FORCE_MAJEURE') ? 'FORCE_MAJEURE'
    : 'PLANNED';

  const status = deriveStatus(nominalPowerMW, availablePowerMW, type);

  return {
    id: String(r['id'] ?? r['eic_code'] ?? unitName + '-' + startDate.toISOString()),
    plantName,
    unitName,
    nominalPowerMW,
    availablePowerMW,
    status,
    startDate,
    endDate,
    type,
    updatedAt: parseDate(r['updated_date'] as string | undefined) ?? new Date(),
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

/** Extrait le nom de centrale depuis le nom d'unité RTE (ex. "GRAVELINES-1" → "Gravelines") */
function derivePlantName(unitName: string): string {
  // Cherche un match dans NUCLEAR_PLANTS par comparaison normalisée
  const norm = normalizeText(unitName);
  for (const plant of NUCLEAR_PLANTS) {
    if (norm.includes(normalizeText(plant.name))) return plant.name;
  }
  // Fallback : strip le numéro de tranche (GRAVELINES-1 → Gravelines)
  const base = unitName.replace(/-\d+$/, '').replace(/_\d+$/, '').trim();
  return base || unitName;
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
