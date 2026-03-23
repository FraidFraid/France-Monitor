/**
 * energy-regions.ts — Données énergie par région + flux transfrontaliers.
 *
 * Sources :
 *   - Régions : /api/energy/ecowatt (proxy → ODRÉ eco2mix-regional-tr)
 *   - J-1 delta : appel direct ODRÉ (open data public, CORS supporté)
 *   - Flux : /api/energy/ecowatt (données nationales eco2mix-national-tr)
 *
 * Refresh recommandé : 15 min (granularité éCO2mix).
 */

import type {
  EcowattSignal,
  EnergyMix,
  RegionEnergyStats,
  InterconnectionFlowStats,
} from '../types/index.ts';
import { resolveFlowDirection } from '../utils/flow-direction.ts';
import { parseApiDate } from '../utils/format-date.ts';

// ── Interfaces internes (raw proxy response) ──────────────────────────────

interface Eco2mixRecord {
  code_insee_region: string;
  libelle_region:    string;
  date_heure:        string;
  consommation:      number | null;
  nucleaire:         number | null;
  eolien:            number | null;
  solaire:           number | null;
  hydraulique:       number | null;
  thermique:         number | null;
  bioenergies:       number | null;
  ech_physiques:     number | null;
}

interface Eco2mixNatRecord {
  date_heure:                    string;
  ech_comm_angleterre:           number | null;
  ech_comm_espagne:              number | null;
  ech_comm_italie:               number | null;
  ech_comm_suisse:               number | null;
  ech_comm_allemagne_belgique:   number | null;
}

interface ProxyResponse {
  regional: { results: Eco2mixRecord[] };
  national: { results: Eco2mixNatRecord[] };
}

// ── Constantes ────────────────────────────────────────────────────────────

const API_URL = import.meta.env.PROD
  ? '/api/energy/ecowatt'
  : 'http://localhost:3001/api/energy/ecowatt';

// Source directe ODRÉ pour J-1 (CORS activé sur opendatasoft public datasets)
const ODRE_BASE =
  'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets';

// Facteurs d'émission standard gCO₂/kWh (IPCC median lifecycle)
const CO2_FACTORS = {
  nuclear:  6,
  hydro:    4,
  wind:    11,
  solar:   45,
  gas:    490,
  other:  230,
} as const;

// Capacités NTC en MW (valeurs indicatives RTE — à vérifier selon saison)
// ODRÉ agrège Allemagne + Belgique dans un seul champ
const NTC: Record<string, number> = {
  'FR-GB':   2000,
  'FR-ES':   2800,
  'FR-IT':   3600,
  'FR-CH':   3000,
  'FR-DE/BE': 5000,
};

const FLOW_META: Array<{
  id:        string;
  label:     string;
  field:     keyof Eco2mixNatRecord;
  capacity:  number;
}> = [
  { id: 'FR-GB',   label: 'France ↔ Royaume-Uni', field: 'ech_comm_angleterre',         capacity: NTC['FR-GB']   },
  { id: 'FR-ES',   label: 'France ↔ Espagne',      field: 'ech_comm_espagne',             capacity: NTC['FR-ES']   },
  { id: 'FR-IT',   label: 'France ↔ Italie',        field: 'ech_comm_italie',              capacity: NTC['FR-IT']   },
  { id: 'FR-CH',   label: 'France ↔ Suisse',        field: 'ech_comm_suisse',              capacity: NTC['FR-CH']   },
  { id: 'FR-DE/BE',label: 'France ↔ All./Bel.',     field: 'ech_comm_allemagne_belgique',  capacity: NTC['FR-DE/BE'] },
];

const CACHE_TTL = 15 * 60_000;

// ── Cache ─────────────────────────────────────────────────────────────────

interface Cache {
  regions:      RegionEnergyStats[];
  flows:        InterconnectionFlowStats[];
  fetchedAt:    number;
}
let cache: Cache | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────

function n(v: number | null): number {
  return v ?? 0;
}

function computeSignal(conso: number, prod: number, ech: number): EcowattSignal {
  if (conso === 0) return 'green';
  if (prod === 0) {
    if (ech < -3000) return 'red';
    if (ech < -1000) return 'orange';
    return 'green';
  }
  const ratio = conso / prod;
  if (ratio > 1.25) return 'red';
  if (ratio > 1.10) return 'orange';
  return 'green';
}

function computeCarbonIntensity(mix: EnergyMix): number {
  const total = mix.total || 1;
  return (
    (mix.nuclear * CO2_FACTORS.nuclear +
      mix.hydro  * CO2_FACTORS.hydro  +
      mix.wind   * CO2_FACTORS.wind   +
      mix.solar  * CO2_FACTORS.solar  +
      mix.gas    * CO2_FACTORS.gas    +
      mix.other  * CO2_FACTORS.other) /
    total
  );
}

// flowDirection est résolu via resolveFlowDirection() (src/utils/flow-direction.ts)

/** Estimation solde journalier : puissance * heures écoulées depuis minuit. */
function estimateDailyBalance(powerMW: number, refDate: Date): number {
  const midnight = new Date(refDate);
  midnight.setHours(0, 0, 0, 0);
  const hoursElapsed = (refDate.getTime() - midnight.getTime()) / 3_600_000;
  return powerMW * hoursElapsed;
}

/** ISO 8601 arrondi à la demi-heure précédente pour matcher la granularité éCO2mix. */
function toHalfHourISO(d: Date): string {
  const rounded = new Date(d);
  rounded.setSeconds(0, 0);
  rounded.setMinutes(rounded.getMinutes() < 30 ? 0 : 30);
  return rounded.toISOString().slice(0, 16); // "2026-03-14T08:30"
}

// ── Fetch J-1 (ODRÉ direct) ───────────────────────────────────────────────

async function fetchYesterdayConsumption(): Promise<Map<string, number>> {
  const yesterday = new Date(Date.now() - 24 * 3_600_000);
  const iso = toHalfHourISO(yesterday);

  const url =
    `${ODRE_BASE}/eco2mix-regional-tr/records` +
    `?limit=20` +
    `&select=code_insee_region,consommation` +
    `&where=date_heure="${iso}" AND consommation is not null`;

  const result = new Map<string, number>();
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) return result;
    const data = await resp.json() as { results: Array<{ code_insee_region: string; consommation: number | null }> };
    for (const r of data.results) {
      if (r.consommation != null) result.set(r.code_insee_region, r.consommation);
    }
  } catch {
    // J-1 indisponible : delta affiché comme 0
  }
  return result;
}

// ── Parsers ───────────────────────────────────────────────────────────────

function parseRegions(
  records: Eco2mixRecord[],
  yesterdayConsumption: Map<string, number>,
): RegionEnergyStats[] {
  // Dernier record par région
  const latest = new Map<string, Eco2mixRecord>();
  for (const rec of records) {
    if (!rec.code_insee_region) continue;
    const existing = latest.get(rec.code_insee_region);
    if (!existing || rec.date_heure > existing.date_heure) {
      latest.set(rec.code_insee_region, rec);
    }
  }

  const stats: RegionEnergyStats[] = [];

  for (const [code, rec] of latest) {
    const nuclear = n(rec.nucleaire);
    const hydro   = n(rec.hydraulique);
    const wind    = n(rec.eolien);
    const solar   = n(rec.solaire);
    const gas     = n(rec.thermique);
    const other   = n(rec.bioenergies);
    const total   = nuclear + hydro + wind + solar + gas + other;

    const timestamp = parseApiDate(rec.date_heure) ?? new Date();
    const mix: EnergyMix = {
      timestamp,
      nuclear, hydro, wind, solar, gas, other, total,
    };

    const conso  = n(rec.consommation);
    const ech    = n(rec.ech_physiques);
    const signal = computeSignal(conso, total, ech);

    const consoJ1          = yesterdayConsumption.get(code) ?? 0;
    const consumptionDelta = consoJ1 > 0 ? ((conso - consoJ1) / consoJ1) * 100 : 0;
    const lowCarbonPct     = total > 0 ? ((nuclear + hydro + wind + solar) / total) * 100 : 0;

    stats.push({
      regionCode:          code,
      regionName:          rec.libelle_region,
      updatedAt:           timestamp,
      consumptionMW:       conso,
      consumptionDeltaPct: Math.round(consumptionDelta * 10) / 10,
      production:          mix,
      lowCarbonPct:        Math.round(lowCarbonPct * 10) / 10,
      carbonIntensity:     Math.round(computeCarbonIntensity(mix)),
      ecowattToday:        signal,
      ecowattJ1:           signal, // pas de prévision disponible : même signal
      ecowattJ2:           signal,
    });
  }

  return stats;
}

function parseFlows(
  natRecord: Eco2mixNatRecord,
  yesterday: Eco2mixNatRecord | null,
): InterconnectionFlowStats[] {
  const refDate = parseApiDate(natRecord.date_heure) ?? new Date();
  const flows: InterconnectionFlowStats[] = [];

  for (const meta of FLOW_META) {
    const raw = natRecord[meta.field];
    if (raw == null) continue;

    const powerMW        = raw as number;  // positif = import INTO France (convention éCO2mix)
    const neighborLabel  = meta.label.split('↔')[1].trim();
    // borderCoords [0,0] non utilisées ici (seulement pour DeckGLMap)
    const { direction, title: label } = resolveFlowDirection(
      powerMW, neighborLabel, [0, 0], '#00FFC8', '#FF4B4B', '#00E6B5', '#FF6B6B',
    );
    const utilizationPct = (Math.abs(powerMW) / meta.capacity) * 100;
    const dailyBalance   = estimateDailyBalance(powerMW, refDate);

    // J-1 : même estimation depuis hier
    const rawJ1 = yesterday?.[meta.field] ?? null;
    const dailyBalancePrev = rawJ1 != null
      ? estimateDailyBalance(rawJ1 as number, new Date(refDate.getTime() - 24 * 3_600_000))
      : 0;

    flows.push({
      id:                  meta.id,
      label,
      direction,
      powerMW,
      capacityMW:          meta.capacity,
      utilizationPct:      Math.round(utilizationPct * 10) / 10,
      dailyBalanceMWh:     Math.round(dailyBalance),
      dailyBalancePrevMWh: Math.round(dailyBalancePrev),
      summary:             '', // rempli par flow-summary.ts via getFlowSummary()
      updatedAt:           refDate,
    });
  }

  return flows;
}

// ── API publique ──────────────────────────────────────────────────────────

export interface EnergyRegionsData {
  regions: RegionEnergyStats[];
  flows:   InterconnectionFlowStats[];
}

export async function fetchEnergyRegions(): Promise<EnergyRegionsData> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return { regions: cache.regions, flows: cache.flows };
  }

  const fallback: EnergyRegionsData = { regions: [], flows: [] };

  try {
    // Fetch proxy + J-1 en parallèle
    const [proxyResp, yesterdayConsumption] = await Promise.all([
      fetch(API_URL, { signal: AbortSignal.timeout(10_000) }),
      fetchYesterdayConsumption(),
    ]);

    if (!proxyResp.ok) throw new Error(`Proxy HTTP ${proxyResp.status}`);

    const raw: ProxyResponse = await proxyResp.json();

    if (!raw.regional?.results?.length) throw new Error('No regional records');

    const regions = parseRegions(raw.regional.results, yesterdayConsumption);

    const natRecords = raw.national?.results ?? [];
    const natRecord  = natRecords[0] ?? null;
    const flows      = natRecord ? parseFlows(natRecord, null) : [];

    cache = { regions, flows, fetchedAt: Date.now() };

    console.log(
      `[energy-regions] ${regions.length} régions, ${flows.length} flux — ` +
      `🟢 ${regions.filter(r => r.ecowattToday === 'green').length} / ` +
      `🟡 ${regions.filter(r => r.ecowattToday === 'orange').length} / ` +
      `🔴 ${regions.filter(r => r.ecowattToday === 'red').length}`,
    );

    return { regions, flows };
  } catch (err) {
    console.warn('[energy-regions] Fetch failed, using cache or defaults:', err);
    return cache ? { regions: cache.regions, flows: cache.flows } : fallback;
  }
}

/** Invalide le cache manuellement (ex: après un refresh forcé). */
export function invalidateEnergyRegionsCache(): void {
  cache = null;
}

// ── Historique 7 jours par frontière (pour sparklines) ────────────────────

/** Map<borderId, MW[]> — série chronologique des 7 derniers jours. */
export type BorderHistory = Map<string, number[]>;

interface HistoryCache {
  data:      BorderHistory;
  fetchedAt: number;
}
let historyCache: HistoryCache | null = null;
const HISTORY_TTL = 30 * 60_000; // 30 min (données historiques peu volatiles)

const HISTORY_FIELDS: Array<{ id: string; field: keyof Eco2mixNatRecord }> = [
  { id: 'FR-ES',   field: 'ech_comm_espagne' },
  { id: 'FR-IT',   field: 'ech_comm_italie' },
  { id: 'FR-CH',   field: 'ech_comm_suisse' },
  { id: 'FR-DE/BE',field: 'ech_comm_allemagne_belgique' },
  { id: 'FR-GB',   field: 'ech_comm_angleterre' },
];

/**
 * Fetch les séries horaires des 7 derniers jours pour chaque frontière.
 * Appel direct ODRÉ (CORS OK). Paginé automatiquement.
 * Cache 30 min.
 */
export async function fetchBorderHistory(days = 7): Promise<BorderHistory> {
  if (historyCache && Date.now() - historyCache.fetchedAt < HISTORY_TTL) {
    return historyCache.data;
  }

  const empty: BorderHistory = new Map(HISTORY_FIELDS.map(f => [f.id, []]));

  const since = new Date(Date.now() - days * 24 * 3_600_000);
  const sinceISO = since.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"

  const selectFields = ['date_heure', ...HISTORY_FIELDS.map(f => f.field)].join(',');
  const where = `date_heure >= "${sinceISO}" AND ech_comm_espagne is not null`;

  const records: Eco2mixNatRecord[] = [];
  const PAGE = 100;
  let offset = 0;

  try {
    while (true) {
      const url =
        `${ODRE_BASE}/eco2mix-national-tr/records` +
        `?limit=${PAGE}&offset=${offset}` +
        `&select=${encodeURIComponent(selectFields)}` +
        `&where=${encodeURIComponent(where)}` +
        `&order_by=date_heure`;

      const resp = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!resp.ok) break;

      const data = await resp.json() as { results: Eco2mixNatRecord[]; total_count: number };
      records.push(...data.results);

      if (records.length >= data.total_count || data.results.length < PAGE) break;
      offset += PAGE;
    }
  } catch (err) {
    console.warn('[energy-regions] fetchBorderHistory failed:', err);
    return historyCache?.data ?? empty;
  }

  // Trier chronologiquement et extraire les séries
  records.sort((a, b) => a.date_heure.localeCompare(b.date_heure));

  const result: BorderHistory = new Map();
  for (const { id, field } of HISTORY_FIELDS) {
    result.set(id, records.map(r => n(r[field] as number | null)));
  }

  historyCache = { data: result, fetchedAt: Date.now() };
  console.log(`[energy-regions] history: ${records.length} records, ${days}j`);
  return result;
}
