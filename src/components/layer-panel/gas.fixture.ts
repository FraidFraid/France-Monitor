// src/components/layer-panel/gas.fixture.ts : jeux d'essai des tests du panneau Réseau gaz (jamais importé par l'application).
import type { BiogasDaily, BiogasState, GasNetworkState } from '../../types/index.ts';

export const GAS_NOW = Date.parse('2026-10-02T07:00:00Z'); // 09:00 à Paris, vendredi

export function gasFixture(over: Partial<GasNetworkState> = {}): GasNetworkState {
  return {
    ecogaz: {
      date: '2026-10-02', signal: 'green', message: 'Consommation normale', lastUpdate: new Date(GAS_NOW),
      forecast: [{ date: '2026-10-03', signal: 'green' }, { date: '2026-10-04', signal: 'green' }, { date: '2026-10-05', signal: 'orange' }],
    },
    terminals: [
      { id: 't1', name: 'Dunkerque LNG', type: 'lng-terminal', coordinates: [2.2, 51.0], operator: 'Dunkerque LNG', capacityGWh: 575,
        currentSendOut: 310, utilizationPct: 54, inventoryPct: 71, dataDate: '2026-10-01', status: 'active' },
      { id: 't2', name: 'Fos Tonkin', type: 'lng-terminal', coordinates: [4.9, 43.4], operator: 'Elengy', capacityGWh: 49, status: 'maintenance' },
    ],
    storages: [
      { id: 's1', name: 'Chémery', type: 'underground-storage', coordinates: [1.5, 47.3], operator: 'Storengy', capacityTWh: 37.6, fillLevel: 96, currentStockTWh: 36.1, fillTrend: 'filling', status: 'active' },
      { id: 's2', name: 'Lussagnet', type: 'underground-storage', coordinates: [-0.2, 43.8], operator: 'Terega', capacityTWh: 27, fillLevel: 94, currentStockTWh: 25.4, fillTrend: 'filling', status: 'active' },
      { id: 's3', name: 'Germigny', type: 'underground-storage', coordinates: [3.0, 48.9], operator: 'Storengy', capacityTWh: 11, fillLevel: 89, currentStockTWh: 9.8, fillTrend: 'filling', status: 'active' },
      { id: 's4', name: 'Céré-la-Ronde', type: 'underground-storage', coordinates: [1.1, 47.3], operator: 'Storengy', capacityTWh: 4, fillLevel: 45, fillTrend: 'filling', status: 'active' },
      { id: 's5', name: 'Trois-Fontaines', type: 'underground-storage', coordinates: [5.0, 48.7], operator: 'Storengy', capacityTWh: 1.2, fillLevel: 25, fillTrend: 'withdrawing', status: 'active' },
    ],
    interconnections: [
      { id: 'i1', name: 'Taisnières', country: 'Belgique', direction: 'import', coordinates: [3.9, 50.1], flowGWhDay: 520, maxCapacityGWhDay: 700 },
      { id: 'i2', name: 'Oltingue', country: 'Suisse', direction: 'export', coordinates: [7.4, 47.5], flowGWhDay: -110, maxCapacityGWhDay: 230 },
    ],
    nationalStats: {
      totalStorageCapacityTWh: 131.8, currentStorageTWh: 123.1, averageFillLevel: 93.4, storageTrend: 'filling',
      totalImportGWhDay: 520, totalExportGWhDay: 110, storageNetFlowGWhDay: 412,
    },
    sourceStatus: { ecogaz: 'ok', grtgaz: 'ok', terega: 'ok', odre: 'ok', agsi: 'ok', alsi: 'ok' },
    lastUpdate: new Date(GAS_NOW - 5 * 60_000),
    ...over,
  };
}

export function biogasFixture(over: Partial<BiogasState> = {}): BiogasState {
  const day = (i: number): string => new Date(Date.UTC(2026, 9, 1) - i * 86_400_000).toISOString().slice(0, 10);
  const daily: BiogasDaily[] = Array.from({ length: 30 }, (_, i) => ({
    date: day(i), productionMWh: 25_300 - i * 5, sitesCount: 712, status: i < 3 ? 'Provisoire' : 'Consolidée',
  }));
  return { daily, latestMWh: 25_300, deltaJ1Pct: -1.2, avg7dMWh: 25_800, alert: null, updatedAt: new Date(GAS_NOW), ...over };
}
