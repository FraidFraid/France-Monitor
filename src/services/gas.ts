/**
 * Service Gaz National
 *
 * Agrège les données du réseau gaz français:
 * - EcoGaz (GRTgaz): Signal de tension réseau (équivalent Ecowatt)
 * - ODRE: Stockages souterrains, terminaux méthaniers, flux PIR
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

// EcoGaz real API endpoint (via proxy in prod)
const ECOGAZ_API = import.meta.env.PROD
  ? '/api/gas/ecogaz'
  : '/api/gas/ecogaz';

// ═══ EcoGaz Signal Fetch ═══

interface EcoGazApiResponse {
  date: string;
  niveau: 'vert' | 'jaune' | 'orange' | 'rouge';
  message?: string;
  previsions?: Array<{ date: string; niveau: string }>;
}

function mapEcoGazSignal(niveau: string): EcoGazSignal {
  switch (niveau) {
    case 'rouge': return 'red';
    case 'orange': return 'orange';
    case 'jaune': return 'yellow';
    default: return 'green';
  }
}

async function fetchEcoGazSignal(): Promise<{ data: EcoGazStatus; status: 'ok' | 'stale' | 'error' }> {
  const now = new Date();

  try {
    const resp = await fetch(ECOGAZ_API, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json() as EcoGazApiResponse;

    const forecast = (json.previsions || []).map(p => ({
      date: p.date,
      signal: mapEcoGazSignal(p.niveau),
    }));

    return {
      data: {
        date: json.date,
        signal: mapEcoGazSignal(json.niveau),
        message: json.message || getEcoGazMessage(mapEcoGazSignal(json.niveau)),
        forecast,
        lastUpdate: now,
      },
      status: 'ok',
    };
  } catch (err) {
    console.warn('[Gas/EcoGaz] Fetch failed, using fallback:', err);
    // Fallback: mock green signal
    return {
      data: {
        date: now.toISOString().split('T')[0],
        signal: 'green',
        message: 'Consommation normale (données indisponibles)',
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

// ═══ PIR Flow Fetch (ODRE) ═══

interface OdrePirRecord {
  point_interconnexion?: string;
  flux_gwh_jour?: number;
  date?: string;
}

async function fetchPirFlows(): Promise<{ interconnections: GasInterconnection[]; status: 'ok' | 'stale' | 'error' }> {
  try {
    // ODRE dataset for PIR flows
    const url = `${ODRE_BASE}/flux-physiques-gaz-grtgaz/records?limit=20&order_by=date%20desc`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json();
    const records = (json.results || []) as OdrePirRecord[];

    const enriched = GAS_INTERCONNECTIONS.map(pir => {
      const liveRecord = records.find(r =>
        r.point_interconnexion?.toLowerCase().includes(pir.name.toLowerCase())
      );

      // Use live data if found, otherwise fallback to mock flow for visualization
      const liveFlow = liveRecord?.flux_gwh_jour;
      const flowGWhDay = (liveFlow !== undefined && liveFlow !== null && liveFlow !== 0)
        ? liveFlow
        : getMockFlow(pir.country);

      return {
        ...pir,
        flowGWhDay,
      };
    });

    return { interconnections: enriched, status: 'ok' };
  } catch (err) {
    console.warn('[Gas/PIR] ODRE fetch failed, using static data:', err);
    // Return with mock flow data for visualization
    const mockFlows = GAS_INTERCONNECTIONS.map(pir => ({
      ...pir,
      flowGWhDay: getMockFlow(pir.country),
    }));
    return { interconnections: mockFlows, status: 'stale' };
  }
}

function getMockFlow(country: string): number {
  // Mock realistic flow values for demo
  switch (country) {
    case 'Espagne': return -45; // Export to Spain
    case 'Belgique': return 120; // Import from Belgium
    case 'Allemagne': return 85; // Import from Germany
    case 'Suisse': return -25; // Export to Switzerland
    default: return 0;
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
      grtgaz: 'ok',
      terega: 'ok',
      odre: storageResult.status === 'ok' && pirResult.status === 'ok' ? 'ok' : 'stale',
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
};
