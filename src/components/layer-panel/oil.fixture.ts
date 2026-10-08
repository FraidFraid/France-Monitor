// src/components/layer-panel/oil.fixture.ts : jeux d'essai des tests du panneau Pétrole (jamais importé par l'application).
import type {
  FuelPriceSeries, FuelTensionDashboard, FuelTensionDepartmentSummary, FuelTensionLevel, OilDashboard, OilFreshnessInfo, OilFreshnessLevel,
} from '../../types/index.ts';

export const OIL_NOW = Date.parse('2026-10-02T06:30:00Z'); // 08:30 à Paris

const fresh = (level: OilFreshnessLevel, detail: string): OilFreshnessInfo => ({ level, label: 'FR STRUCTURAL', detail, asOf: '2026-09-30' });
const series = (fuelType: FuelPriceSeries['fuelType'], label: string, latest: number, d7: number): FuelPriceSeries => ({
  fuelType, label, color: '#F59E0B', latestPrice: latest, delta7dCents: d7, delta30dCents: d7 * 2,
  points: [
    { timestamp: '2025-10-02T00:00:00Z', price: latest + 0.05 },
    { timestamp: '2026-09-02T00:00:00Z', price: latest + 0.03 },
    { timestamp: '2026-10-02T00:00:00Z', price: latest },
  ],
});

export function oilFixture(over: Partial<OilDashboard> = {}): OilDashboard {
  return {
    meta: {
      lastUpdate: new Date(OIL_NOW).toISOString(), vigilanceScore: 20, status: 'normal', partialData: false,
      freshness: {
        dashboard: fresh('STRUCTURAL', 'SDES, bilan 2024'), deliveries: fresh('MONTHLY', 'UFIP, août 2026'),
        infrastructure: fresh('STRUCTURAL', 'Raffineries 2025'), harmonized: fresh('PROVISIONAL', 'JODI, juillet 2026'),
        fuelPrices: fresh('DAILY', 'Prix quotidiens'),
      },
    },
    stocks: {
      date: '2026-09-30', nationalStocksDays: 46, totalStocksTons: 17_200_000,
      byProduct: [
        { product: 'Gazole', stocksTons: 9_000_000, daysCover: 46, trend: 'stable' },
        { product: 'Essences', stocksTons: 3_000_000, daysCover: 53, trend: 'up' },
        { product: 'Carburéacteur', stocksTons: 1_000_000, daysCover: 34, trend: 'down' },
        { product: 'Fioul lourd', stocksTons: 100_000, daysCover: 22, trend: 'down' },
      ],
    },
    flows: { netImportTonsPerDay: 154_000, trend: 'stable', importTonsPerDay: 210_000, exportTonsPerDay: 56_000, consumptionTonsPerDay: 180_000 },
    origins: [
      { label: 'Amérique du Nord', volumeMt: 10, sharePct: 23.4 }, { label: 'Afrique', volumeMt: 9, sharePct: 21.2 },
      { label: 'Moyen-Orient', volumeMt: 8, sharePct: 18 }, { label: 'Kazakhstan', volumeMt: 6, sharePct: 12.5 },
      { label: 'Autres', volumeMt: 4, sharePct: 9 },
    ],
    deliveries: [{
      title: 'UFIP', periodLabel: 'en août 2026', publicationDate: '10 septembre 2026', sourceLabel: 'CPDP',
      roadFuelMillionM3: 4.123, roadFuelYoYPct: -1.8, totalProductsMillionTons: 6.42, totalProductsYoYPct: 0.6,
      jetFuelMillionM3: null, jetFuelYoYPct: null, gasoilYoYPct: null, gasolineYoYPct: null,
    }],
    harmonized: {
      available: true, provisional: true, methodologyLabel: 'JODI', sourceLabel: 'JODI Oil', caveat: 'Données <b>provisoires</b>.',
      oilDataMonth: '2026-07', gasDataMonth: '2026-06', latestUfipPeriodLabel: 'août 2026',
      oilProducts: [{ product: 'Gazole', demandKbd: 820.5, importsKbd: 410.25 }], crudeImportsKbd: 900,
      gasTotalDemandTj: 1_500_000, gasLngImportsTj: 600_000, gasPipeImportsTj: 400_000, gasLngSharePct: 60,
    },
    fuelPriceHistory: {
      provider: 'carbu', generatedAt: new Date(OIL_NOW).toISOString(), sourceLabel: 'carbu.com', rangeStart: '2025-10-02', rangeEnd: '2026-10-02',
      series: [series('gazole', 'Gazole (B7)', 1.689, -1.2), series('e10', 'E10', 1.752, 0.6), series('sp98', 'Super 98 (E5)', 1.839, 0.1)],
    },
    localConsumption: null,
    refineries: [
      { id: 'r1', name: 'Gonfreville', operator: 'TotalEnergies', capacityMtPerYear: 12.5, location: [0.2, 49.5], status: 'active', region: 'Normandie' },
      { id: 'r2', name: 'Grandpuits', operator: 'TotalEnergies', capacityMtPerYear: 0, location: [2.9, 48.6], status: 'offline', region: 'Île-de-France' },
    ],
    depots: [],
    sourceStatus: { sdes: 'ok', insee: 'ok', cpdp: 'ok', monthlyConsumption: 'ok', localConsumption: 'ok', fuelPrices: 'ok', pipelines: 'ok' },
    ...over,
  };
}

function dep(code: string, name: string, level: FuelTensionLevel, anomaly: number, delta: number | null): FuelTensionDepartmentSummary {
  return {
    departmentCode: code, departmentName: name, stationCount: 120, anomalyShare: anomaly, avgUpdateAgeMinutes: 42,
    deltaPrice7d: delta, maxDeltaPrice7d: delta, tensionLevel: level,
    freshness: { timestamp: new Date(OIL_NOW - 42 * 60_000).toISOString(), ageMinutes: 42, badge: 'QUASI-LIVE' },
    fuelSignals: [{
      departmentCode: code, departmentName: name, fuelType: 'gazole', avgPrice: 1.701, deltaPrice7d: delta, stationCount: 120,
      anomalyShare: anomaly, avgUpdateAgeMinutes: 42, tensionLevel: level, dataFreshness: { timestamp: null, ageMinutes: 42, badge: 'QUASI-LIVE' },
    }],
  };
}

export function tensionFixture(over: Partial<FuelTensionDashboard> = {}): FuelTensionDashboard {
  const summaries = [dep('13', 'Bouches-du-Rhône', 'HIGH', 6.8, 2.1), dep('59', 'Nord', 'MEDIUM', 3.2, null), dep('75', 'Paris', 'LOW', 0.4, -0.3)];
  return {
    generatedAt: new Date(OIL_NOW - 20 * 60_000).toISOString(), departments: ['13', '59', '75'], signals: [], summaries,
    national: {
      stationCount: 9812, departmentCount: 96, anomalyShare: 2.1, avgUpdateAgeMinutes: 50, medianUpdateAgeMinutes: 38,
      latestUpdateAt: new Date(OIL_NOW - 25 * 60_000).toISOString(),
      tensionLevel: 'LOW', avgPrices: { gazole: 1.689, e10: 1.752 }, topDepartments: summaries.slice(0, 2),
    },
    sourceStatus: 'ok', degraded: false, sourceLabel: 'prix-carburants.gouv.fr', coverageLabel: '96 départements',
    disclaimerFr: 'Signal de prix, pas de volumes livrés.',
    ...over,
  };
}
