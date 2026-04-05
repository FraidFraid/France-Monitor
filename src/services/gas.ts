/**
 * Service Gaz National
 *
 * Agrège les données du réseau gaz français:
 * - EcoGaz (GRTgaz): Signal de tension réseau (équivalent Ecowatt)
 * - ODRE: Stockages souterrains, terminaux méthaniers
 * - ENTSOG: Flux PIR (Points d'Interconnexion de Réseau frontière France)
 *
 * Sources:
 * - https://www.ecogaz.fr/api/ (signal + prévisions)
 * - https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/
 */

import type {
  GasNetworkState,
  EcoGazStatus,
  EcoGazSignal,
  GasStorage,
  GasInterconnection,
} from '../types';
import { GAS_TERMINALS, GAS_STORAGES, GAS_INTERCONNECTIONS } from '../config/gas-infrastructure';

// ═══ Cache ═══

interface GasCache {
  data: GasNetworkState;
  fetchedAt: number;
}

let cache: GasCache | null = null;
const CACHE_TTL = 15 * 60_000; // 15 minutes

// ═══ API URLs ═══

const ODRE_BASE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets';

// ═══ EcoGaz Signal Fetch ═══

interface EcoGazApiResponse {
  results: Array<{
    gas_day: string;
    color: string;
    couleur_du_signal_fr: string;
  }>;
}

function mapEcoGazSignal(niveau: string): EcoGazSignal {
  const n = (niveau || '').toLowerCase();
  switch (n) {
    case 'rouge': 
    case 'red': return 'red';
    case 'orange': return 'orange';
    case 'jaune': 
    case 'yellow': return 'yellow';
    default: return 'green';
  }
}

async function fetchEcoGazSignal(): Promise<{ data: EcoGazStatus; status: 'ok' | 'stale' | 'error' }> {
  const now = new Date();

  try {
    const url = `${ODRE_BASE}/signal-ecogaz/records?limit=6&order_by=gas_day%20desc`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json() as EcoGazApiResponse;
    const records = json.results || [];

    const todayStr = now.toISOString().split('T')[0];
    const todayRecord = records.find(r => r.gas_day <= todayStr) || records[0];
    
    if (!todayRecord) {
      throw new Error('No EcoGaz records found');
    }

    const forecast = records
      .filter(r => r.gas_day > todayStr)
      .map(p => ({
        date: p.gas_day,
        signal: mapEcoGazSignal(p.color),
      }));

    const currentSignal = mapEcoGazSignal(todayRecord.color);

    return {
      data: {
        date: todayRecord.gas_day,
        signal: currentSignal,
        message: getEcoGazMessage(currentSignal),
        forecast,
        lastUpdate: now,
      },
      status: 'ok',
    };
  } catch (err) {
    console.warn('[Gas/EcoGaz] Fetch failed:', err);
    return {
      data: {
        date: now.toISOString().split('T')[0],
        signal: 'unknown',
        message: 'Données indisponibles',
        forecast: [],
        lastUpdate: now,
      },
      status: 'error',
    };
  }
}

function getEcoGazMessage(signal: EcoGazSignal): string {
  switch (signal) {
    case 'red': return 'Situation très tendue - Actions immédiates requises';
    case 'orange': return 'Système sous tension - Vigilance renforcée';
    case 'yellow': return 'Consommation modérée - Éco-gestes recommandés';
    default: return 'Consommation normale';
  }
}

// ═══ Storage Fill Levels Fetch (ODRE) ═══

interface OdreStorageRecord {
  nom_site?: string;
  code_site?: string;
  taux_remplissage?: number;
  stock_twh?: number;
  capacite_twh?: number;
  date_maj?: string;
}

async function fetchStorageLevels(): Promise<{ storages: GasStorage[]; status: 'ok' | 'stale' | 'error' }> {
  try {
    // ODRE dataset for gas storage levels
    const url = `${ODRE_BASE}/stock-quotidien-stockages-gaz/records?limit=50&order_by=date%20desc`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json();
    const records = (json.results || []) as OdreStorageRecord[];

    // Enrich static storage config with live fill levels
    const enriched = GAS_STORAGES.map(storage => {
      const liveRecord = records.find(r =>
        r.nom_site?.toLowerCase().includes(storage.name.toLowerCase()) ||
        r.code_site === storage.id
      );

      return {
        ...storage,
        fillLevel: liveRecord?.taux_remplissage ?? storage.fillLevel,
        fillTrend: determineFillTrend(liveRecord),
      };
    });

    return { storages: enriched, status: 'ok' };
  } catch (err) {
    console.warn('[Gas/Storage] ODRE fetch failed, using static data:', err);
    return { storages: GAS_STORAGES, status: 'stale' };
  }
}

function determineFillTrend(_record?: OdreStorageRecord): 'filling' | 'stable' | 'withdrawing' {
  // Fallback saisonnier quand aucun enregistrement live n'est disponible
  const month = new Date().getMonth();
  if (month >= 3 && month <= 9) return 'filling'; // avril–septembre
  return 'withdrawing';
}

/**
 * Dérive la tendance nationale à partir du bilan net du jour.
 * Import net > seuil → soutirage (réseau tire sur les stocks)
 * Export net > seuil → remplissage (surplus stocké)
 * Sinon stable.
 */
function deriveNationalTrend(
  totalImportGWhDay: number,
  totalExportGWhDay: number,
): 'filling' | 'stable' | 'withdrawing' {
  const net = totalImportGWhDay - totalExportGWhDay; // positif = import net = on consomme plus qu'on n'envoie
  if (net >  50) return 'withdrawing'; // import net élevé → on tire sur les stocks
  if (net < -50) return 'filling';     // export net élevé → on stocke l'excédent
  return 'stable';
}

// ═══ PIR Flow Fetch (ENTSOG) ═══

interface EntsogPirPoint {
  pointKey: string;
  pointLabel: string;
  flowGWhDay: number;
  periodFrom: string | null;
}

interface EntsogPirResponse {
  points: EntsogPirPoint[];
  fetchedAt: string;
  status: 'ok' | 'partial' | 'error';
  error?: string;
}

function buildFallbackInterconnections(): GasInterconnection[] {
  return GAS_INTERCONNECTIONS.map(pir => ({
    ...pir,
    flowGWhDay: 0,
  }));
}

async function fetchPirFlows(): Promise<{ interconnections: GasInterconnection[]; status: 'ok' | 'stale' | 'error' }> {
  try {
    const resp = await fetch('/api/energy/gas-pir', { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = (await resp.json()) as EntsogPirResponse;
    const points = Array.isArray(json.points) ? json.points : [];

    const enriched = GAS_INTERCONNECTIONS.map(ic => {
      const pirData = points.find(p => p.pointKey === ic.entsogKey);
      return { ...ic, flowGWhDay: pirData?.flowGWhDay ?? 0 };
    });

    // 'ok' ou 'partial' = données live (même partielles) ; 'error' = stale
    const status: 'ok' | 'stale' = (json.status === 'ok' || json.status === 'partial') ? 'ok' : 'stale';
    return { interconnections: enriched, status };
  } catch (err) {
    console.warn('[Gas/PIR] ENTSOG fetch failed, using fallback flows:', err);
    return { interconnections: buildFallbackInterconnections(), status: 'stale' };
  }
}

// ═══ Main Fetch Function ═══

export async function fetchGasNetwork(): Promise<GasNetworkState> {
  console.log('[Gas] fetchGasNetwork() called');

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    console.log('[Gas] Returning cached data');
    return cache.data;
  }

  // Fetch all sources in parallel
  const [ecogazResult, storageResult, pirResult] = await Promise.all([
    fetchEcoGazSignal(),
    fetchStorageLevels(),
    fetchPirFlows(),
  ]);

  // Calculate national stats
  const storages = storageResult.storages;
  const totalCapacity = storages.reduce((sum, s) => sum + s.capacityTWh, 0);
  const currentStorage = storages.reduce((sum, s) => sum + (s.capacityTWh * s.fillLevel / 100), 0);
  const avgFill = totalCapacity > 0 ? (currentStorage / totalCapacity) * 100 : 0;

  const interconnections = pirResult.interconnections;
  const totalImport = interconnections.filter(i => i.flowGWhDay > 0).reduce((sum, i) => sum + i.flowGWhDay, 0);
  const totalExport = Math.abs(interconnections.filter(i => i.flowGWhDay < 0).reduce((sum, i) => sum + i.flowGWhDay, 0));

  const state: GasNetworkState = {
    ecogaz: ecogazResult.data,
    terminals: GAS_TERMINALS,
    storages,
    interconnections,
    nationalStats: {
      totalStorageCapacityTWh: totalCapacity,
      currentStorageTWh: currentStorage,
      averageFillLevel: avgFill,
      storageTrend: deriveNationalTrend(totalImport, totalExport),
      totalImportGWhDay: totalImport,
      totalExportGWhDay: totalExport,
    },
    sourceStatus: {
      ecogaz: ecogazResult.status,
      grtgaz: pirResult.status,
      terega: pirResult.status,
      odre: storageResult.status,
    },
    lastUpdate: new Date(),
  };

  cache = { data: state, fetchedAt: Date.now() };
  console.log(`[Gas] Data cached: EcoGaz=${state.ecogaz.signal}, Storages=${storages.length}, Fill=${avgFill.toFixed(1)}%`);

  return state;
}

// ═══ Helpers ═══

export function getEcoGazColor(signal: EcoGazSignal): string {
  switch (signal) {
    case 'red':    return '#A855F7'; // violet vif — alerte
    case 'orange': return '#C084FC'; // violet clair — tension
    case 'yellow': return '#67E8F9'; // cyan clair — vigilance légère
    case 'unknown': return '#6B7280'; // gris clair — indisponible
    default:       return '#06B6D4'; // cyan — réseau détendu
  }
}

export function getStorageFillColor(fillLevel: number): string {
  if (fillLevel < 30) return '#EF4444'; // Red - critically low
  if (fillLevel < 50) return '#F59E0B'; // Orange - low
  if (fillLevel < 70) return '#EAB308'; // Yellow - moderate
  return '#22C55E'; // Green - good
}

export function isGasPanelEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_GAS_PANEL !== 'false';
}

// ═══ EcoGaz Labels ═══

export const ECOGAZ_LABELS: Record<EcoGazSignal, string> = {
  green: 'Consommation normale',
  yellow: 'Vigilance',
  orange: 'Alerte',
  red: 'Crise',
  unknown: 'Indisponible',
};
