import type {
  FuelPriceHistorySnapshot,
  FuelPriceSeries,
  FuelPriceSeriesKey,
  OilDashboard,
  OilFlowsSnapshot,
  OilFreshnessInfo,
  OilHarmonizedSnapshot,
  OilLocalConsumptionSnapshot,
  OilMonthlyDelivery,
  OilOriginShare,
  OilProductStock,
  OilStocksSnapshot,
  OilVigilanceStatus,
} from '../types';
import {
  OIL_DEPOTS,
  OIL_REFINERIES,
  OIL_VIGILANCE_THRESHOLDS,
} from '../config/oil-infrastructure';
import { Watchdog } from './watchdog.ts';

Watchdog.register('oil-dashboard', {
  label: 'Pétrole SDES / INSEE',
  staleAfterMs: 30 * 60_000,
  detail: 'SDES stocks + INSEE origines + CPDP livraisons',
  freshness: 'HISTORIQUE',
});

type SourceFetchStatus = 'ok' | 'stale' | 'error';

interface OilCache {
  data: OilDashboard;
  fetchedAt: number;
}

interface AnnualOilStats {
  year: number;
  crudeImportMtep: number;
  refinedImportMtep: number;
  refinedExportMtep: number;
  refinedConsumptionMtep: number;
  reserveMtep: number;
  sourceLabel?: string;
}

interface MonthlyOilConsumptionRow {
  period: string;
  year: number;
  carbureacteur: number;
  fod: number;
  fol: number;
  gazole: number;
  superSansPlomb: number;
  superEthE85: number;
}

const CACHE_TTL = 30 * 60_000;
const OIL_PROXY_ENDPOINT = '/api/oil-proxy';
const FUEL_PRICES_PROXY_ENDPOINT = '/api/fuel-prices-proxy';

const SDES_PETROLE_URL = 'https://www.statistiques.developpement-durable.gouv.fr/edition-numerique/chiffres-cles-energie/fr/12-petrole';
const INSEE_PETROLE_URL = 'https://www.insee.fr/fr/statistiques/2119697';
const UFIP_COMMUNIQUES_URL = 'https://www.energiesetmobilites.fr/presse/communiques';
const DATA_GOUV_LOCAL_DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/donnees-locales-de-consommation-de-produits-petroliers-departement-a-partir-de-2005/';
const DATA_GOUV_MONTHLY_DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/donnees-mensuelles-de-consommation-de-produits-petroliers-a-partir-de-2017/';
const CARBU_PRIX_MOYENS_URL = 'https://carbu.com/france/prixmoyens';
const CARBU_API_URL_FALLBACK = 'https://api.carbu.com/v1.1';
const CARBU_API_KEY_FALLBACK = 'VsVAqT5t6NoRsIAMtUbxAFJh9UVOjkhfibyArhS7';
const OFFICIAL_FUEL_DATASET_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
const OFFICIAL_FUEL_HISTORY_LIMIT = 400;
const JODI_OIL_BASE_URL = 'https://www.jodidata.org/_resources/files/downloads/oil-data/annual-csv';
const JODI_GAS_ZIP_URL = 'https://www.jodidata.org/jodi-publisher/gas/17/GAS_world_NewFormat.zip';
const JODI_GAS_ZIP_ENTRY = 'STAGING_world_NewFormat.csv';

let cache: OilCache | null = null;

// ─── Données de référence SDES/CPDP (dernier millésime consolidé) ────────────
// Utilisées comme fallback quand le scraping des pages vivantes échoue.
const FALLBACK_ANNUAL_STATS: AnnualOilStats = {
  year: 2024,
  crudeImportMtep: 45.6,
  refinedImportMtep: 38.5,
  refinedExportMtep: 16.0,
  refinedConsumptionMtep: 60.9,
  reserveMtep: 7.6,
  sourceLabel: 'SDES — Chiffres clés de l’énergie 2025 (données 2024)',
};

const FALLBACK_ORIGINS: OilOriginShare[] = [
  { label: 'Amérique du Nord',      sharePct: 23.0, volumeMt: 10.5, referenceYear: 2024, sourceLabel: 'SDES — provenance du brut importé (2024)', partialBreakdown: false, breakdown: [] },
  { label: 'Afrique subsaharienne', sharePct: 21.0, volumeMt: 9.6, referenceYear: 2024, sourceLabel: 'SDES — provenance du brut importé (2024)', partialBreakdown: false, breakdown: [] },
  { label: 'Afrique du Nord',       sharePct: 17.0, volumeMt: 7.8, referenceYear: 2024, sourceLabel: 'SDES — provenance du brut importé (2024)', partialBreakdown: false, breakdown: [] },
  { label: 'Autres origines SDES',  sharePct: 39.0, volumeMt: 17.8, referenceYear: 2024, sourceLabel: 'SDES — provenance du brut importé (2024)', partialBreakdown: true, breakdown: [] },
];

const OIL_FRESHNESS_TEXT = {
  dashboard: 'Vue France structurale: backbone SDES/CPDP/UFIP, avec stocks, flux, origines et raffinage ramenés à un référentiel FR stable.',
  deliveries: 'Vue mensuelle UFIP/CPDP: indicateurs de livraisons et de consommation, utiles pour la fraîcheur mais non assimilables à une télémesure live.',
  infrastructure: 'Vue STRUCTURAL: raffineries, dépôts, pipelines et hubs cartographiés comme référentiel, sans état opérationnel live.',
  harmonized: 'Vue harmonisée JODI/UFIP: plus fraîche, mais méthodologie mixte et partiellement internationale. À lire comme signal provisoire.',
  fuelPrices: 'Vue DAILY: prix et ruptures carburants quasi temps réel. Ces flux décrivent les prix/disponibilités, pas les volumes livrés.',
} as const;

interface JodiOilProductSnapshot {
  demandKbd: number | null;
  importsKbd: number | null;
}

interface JodiOilSnapshot {
  dataMonth: string;
  gasoline: JodiOilProductSnapshot;
  diesel: JodiOilProductSnapshot;
  jet: JodiOilProductSnapshot;
  lpg: JodiOilProductSnapshot;
  crudeImportsKbd: number | null;
}

interface JodiGasSnapshot {
  dataMonth: string;
  totalDemandTj: number | null;
  lngImportsTj: number | null;
  pipeImportsTj: number | null;
  totalImportsTj: number | null;
  lngSharePct: number | null;
}

const CARBU_FUEL_SERIES: Array<{
  fuelId: number;
  fuelType: FuelPriceSeriesKey;
  label: string;
  color: string;
}> = [
  { fuelId: 1, fuelType: 'gazole', label: 'Gazole (B7)', color: '#F59E0B' },
  { fuelId: 2, fuelType: 'sp95', label: 'Super 95 (E5)', color: '#38BDF8' },
  { fuelId: 3, fuelType: 'sp98', label: 'Super 98 (E5)', color: '#F43F5E' },
  { fuelId: 4, fuelType: 'gpl', label: 'GPL', color: '#A78BFA' },
] as const;

const OFFICIAL_FUEL_SERIES: Array<{
  fuelType: Extract<FuelPriceSeriesKey, 'gazole' | 'sp95' | 'sp98'>;
  label: string;
  color: string;
  priceField: 'gazole_prix' | 'sp95_prix' | 'sp98_prix';
  updatedField: 'gazole_maj' | 'sp95_maj' | 'sp98_maj';
}> = [
  { fuelType: 'gazole', label: 'Gazole (B7)', color: '#F59E0B', priceField: 'gazole_prix', updatedField: 'gazole_maj' },
  { fuelType: 'sp95', label: 'Super 95 (E5)', color: '#38BDF8', priceField: 'sp95_prix', updatedField: 'sp95_maj' },
  { fuelType: 'sp98', label: 'Super 98 (E5)', color: '#F43F5E', priceField: 'sp98_prix', updatedField: 'sp98_maj' },
] as const;

export function isOilPanelEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_OIL_LAYER;
  if (import.meta.env.DEV) return true;
  return flag === 'true' || flag === '1';
}

function buildProxyUrl(targetUrl: string): string {
  const params = new URLSearchParams({ url: targetUrl });
  return `${OIL_PROXY_ENDPOINT}?${params.toString()}`;
}

async function fetchProxyText(targetUrl: string): Promise<string> {
  const response = await fetch(buildProxyUrl(targetUrl), {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} on ${targetUrl}`);
  }

  return response.text();
}

async function fetchProxyJson<T>(targetUrl: string): Promise<T> {
  const text = await fetchProxyText(targetUrl);
  return JSON.parse(text) as T;
}

async function fetchProxyArrayBuffer(targetUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(buildProxyUrl(targetUrl), {
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} on ${targetUrl}`);
  }

  return response.arrayBuffer();
}

async function fetchFuelPricesProxyJson<T>(targetUrl: string): Promise<T> {
  const response = await fetch(`${FUEL_PRICES_PROXY_ENDPOINT}?url=${encodeURIComponent(targetUrl)}`, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} on ${targetUrl}`);
  }

  return response.json() as Promise<T>;
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildCarbuApiUrl(apiUrl: string, apiKey: string, fuelId: number, dateStart: string, dateEnd: string): string {
  const params = new URLSearchParams({
    api_key: apiKey,
    dateStart,
    dateEnd,
  });
  return `${apiUrl}/maxfuelprice/FR/${fuelId}?${params.toString()}`;
}

function extractCarbuApiConfig(html: string): { apiUrl: string; apiKey: string } {
  const apiUrl = html.match(/var\s+APIURL\s*=\s*['"]([^'"]+)['"]/)?.[1]?.trim() ?? '';
  const apiKey = html.match(/var\s+APIKEY\s*=\s*['"]([^'"]+)['"]/)?.[1]?.trim() ?? '';

  if (!apiUrl || !apiKey) {
    throw new Error('Unable to extract CARBU API configuration from prixmoyens page');
  }

  return { apiUrl, apiKey };
}

async function resolveCarbuApiConfig(): Promise<{ apiUrl: string; apiKey: string }> {
  try {
    const pageHtml = await fetchProxyText(CARBU_PRIX_MOYENS_URL);
    return extractCarbuApiConfig(pageHtml);
  } catch {
    return {
      apiUrl: CARBU_API_URL_FALLBACK,
      apiKey: CARBU_API_KEY_FALLBACK,
    };
  }
}

function toIsoFromUnixSeconds(value: string): string | null {
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function findPointAtOrBefore(
  points: Array<{ timestamp: string; price: number }>,
  targetTime: number,
): { timestamp: string; price: number } | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const pointTime = new Date(points[index].timestamp).getTime();
    if (Number.isFinite(pointTime) && pointTime <= targetTime) {
      return points[index];
    }
  }
  return null;
}

function computeDeltaCents(
  points: Array<{ timestamp: string; price: number }>,
  latestPrice: number | null,
  days: number,
): number | null {
  if (latestPrice === null || points.length === 0) return null;
  const latestTime = new Date(points[points.length - 1].timestamp).getTime();
  if (!Number.isFinite(latestTime)) return null;

  const reference = findPointAtOrBefore(points, latestTime - days * 24 * 60 * 60 * 1000);
  if (!reference) return null;
  return Math.round((latestPrice - reference.price) * 1000) / 10;
}

async function fetchFuelPriceHistory(): Promise<FuelPriceHistorySnapshot> {
  if (!import.meta.env.DEV) {
    return fetchFuelPriceHistoryFromOfficialDataset();
  }

  const { apiUrl, apiKey } = await resolveCarbuApiConfig();

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 1);

  const dateStart = formatDateInput(startDate);
  const dateEnd = formatDateInput(endDate);

  const seriesResults = await Promise.allSettled(CARBU_FUEL_SERIES.map(async (fuel): Promise<FuelPriceSeries> => {
    const payload = await fetchProxyJson<{
      data?: Record<string, string>;
    }>(buildCarbuApiUrl(apiUrl, apiKey, fuel.fuelId, dateStart, dateEnd));

    const points = Object.entries(payload.data ?? {})
      .map(([unixSeconds, price]) => {
        const timestamp = toIsoFromUnixSeconds(unixSeconds);
        const numericPrice = Number.parseFloat(price);
        if (!timestamp || !Number.isFinite(numericPrice)) return null;
        return { timestamp, price: numericPrice };
      })
      .filter((point): point is { timestamp: string; price: number } => point !== null)
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

    const latestPrice = points.at(-1)?.price ?? null;

    return {
      fuelType: fuel.fuelType,
      label: fuel.label,
      color: fuel.color,
      latestPrice,
      delta7dCents: computeDeltaCents(points, latestPrice, 7),
      delta30dCents: computeDeltaCents(points, latestPrice, 30),
      points,
    };
  }));

  const series: FuelPriceSeries[] = [];
  const missingFuelTypes = new Set<Extract<FuelPriceSeriesKey, 'gazole' | 'sp95' | 'sp98'>>();

  seriesResults.forEach((result, index) => {
    const fuel = CARBU_FUEL_SERIES[index];
    if (!fuel) return;

    if (result.status === 'fulfilled' && result.value.points.length > 0) {
      series.push(result.value);
      return;
    }

    if (fuel.fuelType === 'gazole' || fuel.fuelType === 'sp95' || fuel.fuelType === 'sp98') {
      missingFuelTypes.add(fuel.fuelType);
    }
  });

  if (series.length === 0) {
    return fetchFuelPriceHistoryFromOfficialDataset();
  }

  if (missingFuelTypes.size > 0) {
    const supplementalResults = await Promise.allSettled(
      OFFICIAL_FUEL_SERIES
        .filter((config) => missingFuelTypes.has(config.fuelType))
        .map((config) => fetchOfficialFuelHistorySeries(config)),
    );

    supplementalResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.points.length > 0) {
        series.push(result.value);
      }
    });
  }

  const hydratedSeries = [...series].sort(
    (left, right) => CARBU_FUEL_SERIES.findIndex((fuel) => fuel.fuelType === left.fuelType)
      - CARBU_FUEL_SERIES.findIndex((fuel) => fuel.fuelType === right.fuelType),
  );

  const supplementedByOfficial = hydratedSeries.some((entry) => entry.fuelType !== 'gpl')
    && missingFuelTypes.size > 0;

  return {
    provider: supplementedByOfficial ? 'data-economie' : 'carbu',
    generatedAt: new Date().toISOString(),
    sourceLabel: supplementedByOfficial
      ? 'Prix carburants France — CARBU.COM complété par l’API officielle prix des carburants'
      : 'Prix moyens France via CARBU.COM (API utilisée par la page prixmoyens)',
    rangeStart: dateStart,
    rangeEnd: dateEnd,
    series: hydratedSeries,
  };
}

type OfficialFuelHistoryRow = {
  avg_price?: number | null;
  ['year(gazole_maj)']?: number | null;
  ['month(gazole_maj)']?: number | null;
  ['day(gazole_maj)']?: number | null;
  ['year(sp95_maj)']?: number | null;
  ['month(sp95_maj)']?: number | null;
  ['day(sp95_maj)']?: number | null;
  ['year(sp98_maj)']?: number | null;
  ['month(sp98_maj)']?: number | null;
  ['day(sp98_maj)']?: number | null;
};

function toOfficialHistoryTimestamp(year: number | null | undefined, month: number | null | undefined, day: number | null | undefined): string | null {
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
}

async function fetchOfficialFuelHistorySeries(config: typeof OFFICIAL_FUEL_SERIES[number]): Promise<FuelPriceSeries> {
  const params = new URLSearchParams({
    select: [
      `year(${config.updatedField}) as y`,
      `month(${config.updatedField}) as m`,
      `day(${config.updatedField}) as d`,
      `avg(${config.priceField}) as avg_price`,
    ].join(','),
    where: `${config.priceField} is not null and ${config.updatedField} is not null`,
    group_by: [
      `year(${config.updatedField})`,
      `month(${config.updatedField})`,
      `day(${config.updatedField})`,
    ].join(','),
    limit: String(OFFICIAL_FUEL_HISTORY_LIMIT),
  });

  const payload = await fetchFuelPricesProxyJson<{
    results?: OfficialFuelHistoryRow[];
  }>(`${OFFICIAL_FUEL_DATASET_URL}?${params.toString()}`);

  const points = (payload.results ?? [])
    .map((row) => {
      const timestamp = toOfficialHistoryTimestamp(
        (row as Record<string, number | null | undefined>)[`year(${config.updatedField})`],
        (row as Record<string, number | null | undefined>)[`month(${config.updatedField})`],
        (row as Record<string, number | null | undefined>)[`day(${config.updatedField})`],
      );
      const price = typeof row.avg_price === 'number' ? row.avg_price : Number.NaN;
      if (!timestamp || !Number.isFinite(price)) return null;
      return { timestamp, price: Math.round(price * 1000) / 1000 };
    })
    .filter((point): point is { timestamp: string; price: number } => point !== null)
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  const latestPrice = points.at(-1)?.price ?? null;

  return {
    fuelType: config.fuelType,
    label: config.label,
    color: config.color,
    latestPrice,
    delta7dCents: computeDeltaCents(points, latestPrice, 7),
    delta30dCents: computeDeltaCents(points, latestPrice, 30),
    points,
  };
}

async function fetchFuelPriceHistoryFromOfficialDataset(): Promise<FuelPriceHistorySnapshot> {
  const seriesResults = await Promise.allSettled(
    OFFICIAL_FUEL_SERIES.map((config) => fetchOfficialFuelHistorySeries(config)),
  );

  const series = seriesResults.flatMap((result, index) => {
    if (result.status === 'fulfilled' && result.value.points.length > 0) return [result.value];
    if (result.status === 'rejected') {
      console.warn(`[Oil] Official fuel history fetch failed for ${OFFICIAL_FUEL_SERIES[index]?.fuelType ?? 'unknown'}:`, result.reason);
    }
    return [];
  });

  if (series.length === 0) {
    throw new Error('No official fuel price history series available');
  }

  const timestamps = series.flatMap((entry) => entry.points.map((point) => point.timestamp)).sort();

  return {
    provider: 'data-economie',
    generatedAt: new Date().toISOString(),
    sourceLabel: 'API prix des carburants en France – flux instantané v2 (agrégation journalière nationale)',
    rangeStart: timestamps[0]?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    rangeEnd: timestamps.at(-1)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    series,
  };
}

function parseFrNumber(raw: string | null | undefined): number {
  if (!raw) return Number.NaN;
  const normalized = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  return Number.parseFloat(normalized);
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;|&rsquo;/g, '\'')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&uuml;/g, 'ü')
    .replace(/&ccedil;/g, 'ç')
    .replace(/<sup>3<\/sup>/gi, 'm3')
    .replace(/<sup>3 <\/sup>/gi, 'm3')
    .replace(/<sup>3<\/sup>/gi, 'm3')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsvLine(line: string, delimiter = ';'): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

function parseDelimitedRecords(text: string, delimiter = ';'): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

function parseJodiObsValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'x' || trimmed.toLowerCase() === 'na') return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
}

const JODI_OIL_PRODUCTS = {
  GASOLINE: 'Gasoline',
  GASDIES: 'Diesel',
  JETKERO: 'Jet fuel',
  LPG: 'LPG',
} as const;

const JODI_GAS_FLOW_MAP = {
  IMPLNG: 'lngImportsTj',
  IMPPIP: 'pipeImportsTj',
  TOTIMPSB: 'totalImportsTj',
  TOTDEMO: 'totalDemandTj',
} as const;

function extractFranceJodiOil(records: Array<Record<string, string>>): JodiOilSnapshot | null {
  const rows = records.filter((row) =>
    row.REF_AREA === 'FR' &&
    row.UNIT_MEASURE === 'KBD',
  );
  if (rows.length === 0) return null;

  const rowsByMonth = new Map<string, Array<Record<string, string>>>();
  for (const row of rows) {
    const month = row.TIME_PERIOD;
    if (!month) continue;
    if (!rowsByMonth.has(month)) rowsByMonth.set(month, []);
    rowsByMonth.get(month)!.push(row);
  }

  const months = [...rowsByMonth.keys()].sort((left, right) => right.localeCompare(left));
  const selectedMonth = months.find((month) => {
    const monthRows = rowsByMonth.get(month) ?? [];
    const validRows = monthRows.filter((row) => row.ASSESSMENT_CODE === '1' || row.ASSESSMENT_CODE === '2');
    const hasSecondaryData = validRows.some((row) => row.ENERGY_PRODUCT in JODI_OIL_PRODUCTS);
    return hasSecondaryData;
  });

  if (!selectedMonth) return null;
  const monthRows = rowsByMonth.get(selectedMonth) ?? [];

  const pickValue = (energyProduct: string, flow: string, capDemand = false): number | null => {
    const row = monthRows.find((entry) =>
      entry.ENERGY_PRODUCT === energyProduct &&
      entry.FLOW_BREAKDOWN === flow &&
      (entry.ASSESSMENT_CODE === '1' || entry.ASSESSMENT_CODE === '2'),
    );
    const value = parseJodiObsValue(row?.OBS_VALUE);
    if (value == null) return null;
    if (capDemand && value > 10_000) return null;
    return value;
  };

  return {
    dataMonth: selectedMonth,
    gasoline: {
      demandKbd: pickValue('GASOLINE', 'TOTDEMO', true),
      importsKbd: pickValue('GASOLINE', 'TOTIMPSB'),
    },
    diesel: {
      demandKbd: pickValue('GASDIES', 'TOTDEMO', true),
      importsKbd: pickValue('GASDIES', 'TOTIMPSB'),
    },
    jet: {
      demandKbd: pickValue('JETKERO', 'TOTDEMO', true),
      importsKbd: pickValue('JETKERO', 'TOTIMPSB'),
    },
    lpg: {
      demandKbd: pickValue('LPG', 'TOTDEMO', true),
      importsKbd: pickValue('LPG', 'TOTIMPSB'),
    },
    crudeImportsKbd: pickValue('CRUDEOIL', 'TOTIMPSB') ?? pickValue('TOTCRUDE', 'TOTIMPSB'),
  };
}

async function fetchJodiOilSnapshot(): Promise<JodiOilSnapshot> {
  const currentYear = new Date().getUTCFullYear();
  const candidateYears = [currentYear - 1, currentYear - 2];
  const urls = candidateYears.flatMap((year) => [
    `${JODI_OIL_BASE_URL}/primary/${year}.csv`,
    `${JODI_OIL_BASE_URL}/secondary/${year}.csv`,
  ]);

  const responses = await Promise.allSettled(urls.map((url) => fetchProxyText(url)));
  const records = responses.flatMap((result) => (
    result.status === 'fulfilled' ? parseDelimitedRecords(result.value, ',') : []
  ));

  if (records.length === 0) {
    throw new Error('No JODI Oil CSV rows available');
  }

  const snapshot = extractFranceJodiOil(records);
  if (!snapshot) {
    throw new Error('No France JODI Oil snapshot parsed');
  }

  return snapshot;
}

function findZipEntry(buffer: ArrayBuffer, filename: string): {
  dataOffset: number;
  compressedSize: number;
  compression: number;
} | null {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const LOCAL_HEADER_SIG = 0x04034b50;
  let offset = 0;

  while (offset < buffer.byteLength - 30) {
    const sig = view.getUint32(offset, true);
    if (sig !== LOCAL_HEADER_SIG) {
      offset += 1;
      continue;
    }

    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const entryName = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + filenameLength));
    const dataOffset = offset + 30 + filenameLength + extraLength;

    if (entryName === filename || entryName.endsWith(`/${filename}`)) {
      if ((flags & 0x08) !== 0 && compressedSize === 0) {
        throw new Error('JODI Gas ZIP entry uses data descriptor without compressed size');
      }
      return { dataOffset, compressedSize, compression };
    }

    if ((flags & 0x08) !== 0 && compressedSize === 0) {
      offset += 1;
      continue;
    }

    offset = dataOffset + compressedSize;
  }

  return null;
}

async function extractZipEntryText(zipBuffer: ArrayBuffer, filename: string): Promise<string> {
  const entry = findZipEntry(zipBuffer, filename);
  if (!entry) {
    throw new Error(`ZIP entry not found: ${filename}`);
  }

  const bytes = new Uint8Array(zipBuffer, entry.dataOffset, entry.compressedSize);
  if (entry.compression === 0) {
    return new TextDecoder().decode(bytes);
  }
  if (entry.compression !== 8) {
    throw new Error(`Unsupported ZIP compression: ${entry.compression}`);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is unavailable for JODI Gas ZIP parsing');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function extractFranceJodiGas(csvText: string): JodiGasSnapshot | null {
  const rows = parseDelimitedRecords(csvText, ',').filter((row) =>
    row.REF_AREA === 'FR' &&
    row.UNIT_MEASURE === 'TJ' &&
    row.FLOW_BREAKDOWN in JODI_GAS_FLOW_MAP &&
    (row.ASSESSMENT_CODE === '1' || row.ASSESSMENT_CODE === '2'),
  );

  if (rows.length === 0) return null;

  const periods = [...new Set(rows.map((row) => row.TIME_PERIOD).filter(Boolean))].sort().reverse();
  const selectedMonth = periods[0];
  if (!selectedMonth) return null;

  const monthRows = rows.filter((row) => row.TIME_PERIOD === selectedMonth);
  const values: Partial<Record<(typeof JODI_GAS_FLOW_MAP)[keyof typeof JODI_GAS_FLOW_MAP], number | null>> = {};

  for (const row of monthRows) {
    const field = JODI_GAS_FLOW_MAP[row.FLOW_BREAKDOWN as keyof typeof JODI_GAS_FLOW_MAP];
    values[field] = parseJodiObsValue(row.OBS_VALUE);
  }

  const totalImportsTj = values.totalImportsTj ?? null;
  const lngImportsTj = values.lngImportsTj ?? null;
  const lngSharePct = totalImportsTj && totalImportsTj > 0 && lngImportsTj != null
    ? (lngImportsTj / totalImportsTj) * 100
    : null;

  return {
    dataMonth: selectedMonth,
    totalDemandTj: values.totalDemandTj ?? null,
    lngImportsTj,
    pipeImportsTj: values.pipeImportsTj ?? null,
    totalImportsTj,
    lngSharePct,
  };
}

async function fetchJodiGasSnapshot(): Promise<JodiGasSnapshot> {
  const zipBuffer = await fetchProxyArrayBuffer(JODI_GAS_ZIP_URL);
  const csvText = await extractZipEntryText(zipBuffer, JODI_GAS_ZIP_ENTRY);
  const snapshot = extractFranceJodiGas(csvText);
  if (!snapshot) {
    throw new Error('No France JODI Gas snapshot parsed');
  }
  return snapshot;
}

function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function extractFirstNumber(source: string, pattern: RegExp, label: string): number {
  const match = source.match(pattern);
  const value = parseFrNumber(match?.[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Unable to parse ${label}`);
  }
  return value;
}

function inferTrendFromPct(value: number | null): 'up' | 'down' | 'stable' {
  if (value === null || !Number.isFinite(value)) return 'stable';
  if (value > 1.5) return 'up';
  if (value < -1.5) return 'down';
  return 'stable';
}

function signedPercentFromMatch(direction: string, value: string): number {
  const parsed = parseFrNumber(value);
  if (!Number.isFinite(parsed)) return Number.NaN;

  const normalized = direction.toLowerCase();
  if (/(baisse|repli|recul|baiss|diminu)/.test(normalized)) {
    return -parsed;
  }
  return parsed;
}

function extractSignedPercent(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const value = signedPercentFromMatch(match[1] ?? '', match[2] ?? '');
  return Number.isFinite(value) ? value : null;
}

function extractVolume(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  const value = parseFrNumber(match?.[1]);
  return Number.isFinite(value) ? value : null;
}

async function resolveDataGouvCsvUrl(datasetApiUrl: string): Promise<string> {
  const dataset = await fetchProxyJson<{
    resources?: Array<{ format?: string; type?: string; url?: string }>;
  }>(datasetApiUrl);

  const resource = dataset.resources?.find((entry) =>
    entry.url &&
    entry.type === 'main' &&
    entry.format?.toLowerCase() === 'csv'
  );

  if (!resource?.url) {
    throw new Error(`No CSV resource found for ${datasetApiUrl}`);
  }

  return resource.url;
}

async function fetchMonthlyOilConsumptionRows(): Promise<MonthlyOilConsumptionRow[]> {
  const csvUrl = await resolveDataGouvCsvUrl(DATA_GOUV_MONTHLY_DATASET_URL);
  const csv = await fetchProxyText(csvUrl);
  const rows = parseDelimitedRecords(csv);

  return rows
    .map((row) => ({
      period: row.MOIS,
      year: Number.parseInt(row.ANNEE, 10),
      carbureacteur: parseFrNumber(row.CARBUREACTEUR) || 0,
      fod: parseFrNumber(row.FOD) || 0,
      fol: parseFrNumber(row.FOL) || 0,
      gazole: parseFrNumber(row.GAZOLE) || 0,
      superSansPlomb: parseFrNumber(row.SUPER_SANS_PLOMB) || 0,
      superEthE85: parseFrNumber(row.SUPER_ETH_E85) || 0,
    }))
    .filter((row) => row.period);
}

function computeProductStocks(rows: MonthlyOilConsumptionRow[], totalStocksTons: number, nationalStocksDays: number): OilProductStock[] {
  const latestYear = rows.reduce((maxYear, row) => Math.max(maxYear, row.year), 0);
  const latestRows = rows.filter((row) => row.year === latestYear);
  if (latestRows.length === 0) return [];

  const latestRow = latestRows[latestRows.length - 1];
  const previousYearRow = rows.find((row) =>
    row.period === `${latestYear - 1}-${latestRow.period.slice(5)}`
  ) ?? null;

  const annualTotals = {
    gazole: latestRows.reduce((sum, row) => sum + row.gazole, 0),
    essence: latestRows.reduce((sum, row) => sum + row.superSansPlomb + row.superEthE85, 0),
    carburacteur: latestRows.reduce((sum, row) => sum + row.carbureacteur, 0),
    fod: latestRows.reduce((sum, row) => sum + row.fod, 0),
    fol: latestRows.reduce((sum, row) => sum + row.fol, 0),
  };

  const totalVolume = Object.values(annualTotals).reduce((sum, value) => sum + value, 0);
  if (totalVolume <= 0) return [];

  const compare = (current: number, previous: number | null): 'up' | 'down' | 'stable' => {
    if (!previous || previous <= 0) return 'stable';
    const pct = ((current - previous) / previous) * 100;
    return inferTrendFromPct(pct);
  };

  const previousEssence = previousYearRow ? previousYearRow.superSansPlomb + previousYearRow.superEthE85 : null;

  return [
    {
      product: 'Gazole',
      stocksTons: Math.round(totalStocksTons * (annualTotals.gazole / totalVolume)),
      daysCover: nationalStocksDays,
      trend: compare(latestRow.gazole, previousYearRow?.gazole ?? null),
    },
    {
      product: 'Essence SP',
      stocksTons: Math.round(totalStocksTons * (annualTotals.essence / totalVolume)),
      daysCover: nationalStocksDays,
      trend: compare(latestRow.superSansPlomb + latestRow.superEthE85, previousEssence),
    },
    {
      product: 'Carburéacteur',
      stocksTons: Math.round(totalStocksTons * (annualTotals.carburacteur / totalVolume)),
      daysCover: nationalStocksDays,
      trend: compare(latestRow.carbureacteur, previousYearRow?.carbureacteur ?? null),
    },
    {
      product: 'Fioul domestique',
      stocksTons: Math.round(totalStocksTons * (annualTotals.fod / totalVolume)),
      daysCover: nationalStocksDays,
      trend: compare(latestRow.fod, previousYearRow?.fod ?? null),
    },
    {
      product: 'Fioul lourd',
      stocksTons: Math.round(totalStocksTons * (annualTotals.fol / totalVolume)),
      daysCover: nationalStocksDays,
      trend: compare(latestRow.fol, previousYearRow?.fol ?? null),
    },
  ];
}

export async function fetchAnnualOilStatsFromSdes(): Promise<AnnualOilStats> {
  const html = await fetchProxyText(SDES_PETROLE_URL);

  const parsedYear = Number.parseInt(
    html.match(/Importations de pétrole brut[^]*?TOTAL\s*:\s*[0-9]+,[0-9]+\s*Mtep en (\d{4})/i)?.[1] ?? '',
    10,
  );
  const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear() - 1;

  return {
    year,
    crudeImportMtep: extractFirstNumber(html, /Importations de pétrole brut[^]*?TOTAL\s*:\s*([0-9]+,[0-9]+)\s*Mtep/i, 'SDES crude imports'),
    reserveMtep: extractFirstNumber(html, /réserves de pétrole brut\s*\(([0-9]+,[0-9]+)\s*Mtep\)/i, 'SDES reserves'),
    refinedImportMtep: extractFirstNumber(
      html,
      new RegExp(`importations de produits raffinés[^]*?contre\\s*([0-9]+,[0-9]+)\\s*Mtep en ${year}[^]*?augmentation des exportations`, 'i'),
      'SDES refined imports',
    ),
    refinedExportMtep: extractFirstNumber(
      html,
      new RegExp(`exportations de ces produits[^]*?contre\\s*([0-9]+,[0-9]+)\\s*Mtep en ${year}`, 'i'),
      'SDES refined exports',
    ),
    refinedConsumptionMtep: extractFirstNumber(html, /Consommation de produits raffinés[^]*?TOTAL\s*:\s*([0-9]+,[0-9]+)\s*Mtep/i, 'SDES refined consumption'),
    sourceLabel: `SDES — Chiffres clés de l’énergie (${year})`,
  };
}

export async function fetchOilOriginsFromInsee(): Promise<OilOriginShare[]> {
  const html = await fetchProxyText(INSEE_PETROLE_URL);
  const document = parseHtmlDocument(html);
  const rows = Array.from(document.querySelectorAll('#produit-tableau-figure1 tbody tr'));
  const headerCells = Array.from(document.querySelectorAll('#produit-tableau-figure1 thead th'));
  const referenceYear = Number.parseInt(
    headerCells
      .map((cell) => cell.textContent ?? '')
      .find((text) => /\d{4}\s*\(p\)/i.test(text) || /\d{4}/.test(text))
      ?.match(/(\d{4})/)?.[1] ?? '',
    10,
  );
  const sourceLabel = 'Insee / SDES — Provenance du pétrole brut importé en France';

  const origins: OilOriginShare[] = [];
  let currentOrigin: OilOriginShare | null = null;

  for (const row of rows) {
    const headerCell = row.querySelector('th');
    const rawLabel = headerCell?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const label = rawLabel.replace(/^dont\s+/i, '').trim();
    const headerClass = headerCell?.className ?? '';
    const cells = Array.from(row.querySelectorAll('td'));

    if (!label || cells.length < 6) continue;

    const volumeMt = parseFrNumber(cells[4]?.textContent);
    const sharePct = parseFrNumber(cells[5]?.textContent);
    if (!Number.isFinite(volumeMt) || !Number.isFinite(sharePct)) continue;

    if (headerClass.includes('total') || /Importations totales/i.test(label) || /Opep/i.test(label)) {
      continue;
    }

    if (headerClass.includes('ventilation')) {
      if (!currentOrigin || /^:?$/.test(label) || /^dont\s*:?\s*$/i.test(rawLabel)) {
        continue;
      }

      currentOrigin.breakdown ??= [];
      currentOrigin.breakdown.push({
        label,
        volumeMt,
        sharePct,
      });
      continue;
    }

    currentOrigin = {
      label,
      volumeMt,
      sharePct,
      referenceYear: Number.isFinite(referenceYear) ? referenceYear : undefined,
      sourceLabel,
      partialBreakdown: false,
      breakdown: [],
    };
    origins.push(currentOrigin);
  }

  if (origins.length === 0) {
    throw new Error('No oil origins parsed from Insee');
  }

  for (const origin of origins) {
    const coveredShare = (origin.breakdown ?? []).reduce((sum, item) => sum + item.sharePct, 0);
    origin.partialBreakdown = (origin.breakdown?.length ?? 0) > 0 && coveredShare < origin.sharePct - 0.25;
  }

  return origins.sort((left, right) => right.sharePct - left.sharePct);
}

export async function fetchMonthlyDeliveriesFromUfip(): Promise<OilMonthlyDelivery[]> {
  const html = await fetchProxyText(UFIP_COMMUNIQUES_URL);
  const document = parseHtmlDocument(html);
  const articles = Array.from(document.querySelectorAll('article.article'));

  const deliveries = articles
    .map((article): OilMonthlyDelivery | null => {
      const title = article.querySelector('h1.title a')?.textContent?.trim() ?? '';
      if (!title.toLowerCase().startsWith('la consommation française de produits énergétiques')) {
        return null;
      }

      const bodyText = normalizeText(article.innerHTML);
      const periodLabel = title.replace(/^La consommation française de produits énergétiques\s+/i, '').trim();
      const publicationDate = article.querySelector('.date')?.textContent?.replace(/\s+/g, ' ').trim() ?? undefined;

      return {
        title,
        periodLabel,
        publicationDate,
        sourceLabel: 'UFIP Énergies et Mobilités — communiqué mensuel',
        roadFuelMillionM3: extractVolume(bodyText, /carburants routiers[^.]{0,220}?(?:volume de|s['’]établ(?:it|ies|is|issent) à)\s*([0-9]+,[0-9]+)\s*millions?\s+de(?:\s+de)?\s+m3/i),
        roadFuelYoYPct: extractSignedPercent(bodyText, /carburants routiers[^.]{0,220}?(hausse|augmentation|progression|baisse|repli|recul|baiss[ée]s?|augmentent|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
        totalProductsMillionTons: extractVolume(bodyText, /produits pétroliers énergétiques[^.]{0,260}?([0-9]+,[0-9]+)\s*millions?\s+de\s+tonnes/i),
        totalProductsYoYPct: extractSignedPercent(bodyText, /produits pétroliers énergétiques[^.]{0,220}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
        jetFuelMillionM3: extractVolume(bodyText, /carbur[ée]acteur[^.]{0,180}?à\s*([0-9]+,[0-9]+)\s*million(?:s)?\s+de\s+m3/i),
        jetFuelYoYPct: extractSignedPercent(bodyText, /carbur[ée]acteur[^.]{0,180}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
        gasoilYoYPct: extractSignedPercent(bodyText, /gazoles?[^.]{0,120}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse|baiss[ée]s?)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
        gasolineYoYPct: extractSignedPercent(bodyText, /supercarburants?[^.]{0,120}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
      };
    })
    .filter((entry): entry is OilMonthlyDelivery => entry !== null)
    .slice(0, 6);

  if (deliveries.length === 0) {
    throw new Error('No monthly deliveries parsed from UFIP');
  }

  return deliveries;
}

export async function fetchLocalOilConsumption(): Promise<OilLocalConsumptionSnapshot> {
  const csvUrl = await resolveDataGouvCsvUrl(DATA_GOUV_LOCAL_DATASET_URL);
  const csv = await fetchProxyText(csvUrl);
  const rows = parseDelimitedRecords(csv);

  const latestYear = rows.reduce((maxYear, row) => {
    const year = Number.parseInt(row.ANNEE ?? '0', 10);
    return Math.max(maxYear, year);
  }, 0);

  const latestRows = rows.filter((row) => Number.parseInt(row.ANNEE ?? '0', 10) === latestYear);
  if (latestRows.length === 0) {
    throw new Error('No local oil consumption row parsed');
  }

  const byRegion = new Map<string, OilLocalConsumptionSnapshot['topRegions'][number]>();
  for (const row of latestRows) {
    const roadFuelVolume =
      (parseFrNumber(row.GAZOLE) || 0) +
      (parseFrNumber(row.SUPER_SANS_PLOMB) || 0) +
      (parseFrNumber(row.SUPER_ETH_E85) || 0);

    const key = row.REGION_CODE ?? row.REGION_LIBELLE;
    const current = byRegion.get(key) ?? {
      regionCode: row.REGION_CODE ?? '',
      regionName: row.REGION_LIBELLE ?? 'Inconnu',
      roadFuelVolume: 0,
    };

    current.roadFuelVolume += roadFuelVolume;
    byRegion.set(key, current);
  }

  const topRegions = Array.from(byRegion.values())
    .sort((left, right) => right.roadFuelVolume - left.roadFuelVolume)
    .slice(0, 5);

  return {
    year: latestYear,
    totalRoadFuelVolume: Array.from(byRegion.values()).reduce((sum, region) => sum + region.roadFuelVolume, 0),
    topRegions,
    sourceLabel: `SDES / CPDP — données locales ${latestYear}`,
  };
}

function computeVigilanceScore(stocksDays: number, deliveriesTrend: 'up' | 'down' | 'stable'): { score: number; status: OilVigilanceStatus } {
  let baseScore: number;
  let status: OilVigilanceStatus;

  if (stocksDays < OIL_VIGILANCE_THRESHOLDS.critical) {
    baseScore = 80 + (30 - stocksDays) * 2;
    status = 'critical';
  } else if (stocksDays < OIL_VIGILANCE_THRESHOLDS.tense) {
    baseScore = 40 + (60 - stocksDays);
    status = 'tense';
  } else {
    baseScore = Math.max(0, 40 - (stocksDays - 60) * 0.5);
    status = 'normal';
  }

  if (deliveriesTrend === 'up') {
    baseScore += 8;
  } else if (deliveriesTrend === 'down') {
    baseScore -= 5;
  }

  const score = Math.max(0, Math.min(100, Math.round(baseScore)));
  if (status === 'normal' && score > 40) status = 'tense';
  return { score, status };
}

async function settleSource<T>(loader: () => Promise<T>): Promise<{ data: T | null; status: SourceFetchStatus }> {
  try {
    return { data: await loader(), status: 'ok' };
  } catch (error) {
    console.warn('[Oil] Source fetch failed:', error);
    return { data: null, status: 'error' };
  }
}

function buildStocksSnapshot(annual: AnnualOilStats, monthlyRows: MonthlyOilConsumptionRow[] | null): OilStocksSnapshot {
  const nationalStocksDays = Math.round((annual.reserveMtep / annual.refinedConsumptionMtep) * 365);
  const totalStocksTons = Math.round(annual.reserveMtep * 1_000_000);

  return {
    date: `${annual.year}-12-31`,
    nationalStocksDays,
    totalStocksTons,
    byProduct: monthlyRows ? computeProductStocks(monthlyRows, totalStocksTons, nationalStocksDays) : [],
  };
}

function buildFlowsSnapshot(annual: AnnualOilStats, latestDelivery: OilMonthlyDelivery | null): OilFlowsSnapshot {
  const importTonsPerDay = Math.round((annual.crudeImportMtep * 1_000_000) / 365);
  const exportTonsPerDay = Math.round((annual.refinedExportMtep * 1_000_000) / 365);
  const netImportTonsPerDay = importTonsPerDay - exportTonsPerDay;
  const consumptionTonsPerDay = Math.round((annual.refinedConsumptionMtep * 1_000_000) / 365);

  const trendSignal = latestDelivery?.totalProductsYoYPct ?? latestDelivery?.roadFuelYoYPct ?? null;

  return {
    netImportTonsPerDay,
    trend: inferTrendFromPct(trendSignal),
    importTonsPerDay,
    exportTonsPerDay,
    consumptionTonsPerDay,
  };
}

function buildHarmonizedSnapshot(
  jodiOil: JodiOilSnapshot | null,
  jodiGas: JodiGasSnapshot | null,
  latestDelivery: OilMonthlyDelivery | null,
): OilHarmonizedSnapshot | null {
  if (!jodiOil && !jodiGas && !latestDelivery) return null;

  return {
    available: true,
    provisional: true,
    methodologyLabel: 'Vue harmonisée JODI/UFIP',
    sourceLabel: 'JODI Oil + JODI Gas + UFIP mensuel',
    caveat: 'Méthodologie mixte: séries internationales JODI et communiqué mensuel UFIP. Lecture utile pour la fraîcheur 2025–2026, mais non strictement homogène avec le backbone FR SDES/CPDP.',
    oilDataMonth: jodiOil?.dataMonth ?? null,
    gasDataMonth: jodiGas?.dataMonth ?? null,
    latestUfipPeriodLabel: latestDelivery?.periodLabel ?? null,
    oilProducts: [
      { product: 'Gasoline', demandKbd: jodiOil?.gasoline.demandKbd ?? null, importsKbd: jodiOil?.gasoline.importsKbd ?? null },
      { product: 'Diesel', demandKbd: jodiOil?.diesel.demandKbd ?? null, importsKbd: jodiOil?.diesel.importsKbd ?? null },
      { product: 'Jet fuel', demandKbd: jodiOil?.jet.demandKbd ?? null, importsKbd: jodiOil?.jet.importsKbd ?? null },
      { product: 'LPG', demandKbd: jodiOil?.lpg.demandKbd ?? null, importsKbd: jodiOil?.lpg.importsKbd ?? null },
    ],
    crudeImportsKbd: jodiOil?.crudeImportsKbd ?? null,
    gasTotalDemandTj: jodiGas?.totalDemandTj ?? null,
    gasLngImportsTj: jodiGas?.lngImportsTj ?? null,
    gasPipeImportsTj: jodiGas?.pipeImportsTj ?? null,
    gasLngSharePct: jodiGas?.lngSharePct ?? null,
  };
}

function buildFreshnessInfo(
  annual: AnnualOilStats,
  latestDelivery: OilMonthlyDelivery | null,
  harmonized: OilHarmonizedSnapshot | null,
): OilDashboard['meta']['freshness'] {
  const deliveryAsOf = latestDelivery?.periodLabel ?? 'dernier mensuel disponible';
  const harmonizedAsOf = [
    harmonized?.oilDataMonth,
    harmonized?.gasDataMonth,
    harmonized?.latestUfipPeriodLabel,
  ].filter(Boolean).join(' · ');

  return {
    dashboard: {
      level: 'HYBRID',
      label: 'FR STRUCTURAL',
      detail: OIL_FRESHNESS_TEXT.dashboard,
      asOf: String(annual.year),
    } satisfies OilFreshnessInfo,
    deliveries: {
      level: 'MONTHLY',
      label: 'UFIP MONTHLY',
      detail: OIL_FRESHNESS_TEXT.deliveries,
      asOf: deliveryAsOf,
    } satisfies OilFreshnessInfo,
    infrastructure: {
      level: 'STRUCTURAL',
      label: 'STRUCTURAL',
      detail: OIL_FRESHNESS_TEXT.infrastructure,
    } satisfies OilFreshnessInfo,
    harmonized: {
      level: 'PROVISIONAL',
      label: 'PROVISIONAL',
      detail: OIL_FRESHNESS_TEXT.harmonized,
      asOf: harmonizedAsOf || undefined,
    } satisfies OilFreshnessInfo,
    fuelPrices: {
      level: 'DAILY',
      label: 'PRIX / RUPTURES',
      detail: OIL_FRESHNESS_TEXT.fuelPrices,
      asOf: new Date().toISOString().slice(0, 10),
    } satisfies OilFreshnessInfo,
  };
}

export async function fetchOilDashboard(): Promise<OilDashboard> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.data;
  }

  Watchdog.report('oil-dashboard', { type: 'loading' });
  const _t0 = Date.now();

  const [
    annualResult,
    originsResult,
    deliveriesResult,
    monthlyRowsResult,
    localConsumptionResult,
    jodiOilResult,
    jodiGasResult,
    fuelPriceHistoryResult,
  ] = await Promise.all([
    settleSource(fetchAnnualOilStatsFromSdes),
    settleSource(fetchOilOriginsFromInsee),
    settleSource(fetchMonthlyDeliveriesFromUfip),
    settleSource(fetchMonthlyOilConsumptionRows),
    settleSource(fetchLocalOilConsumption),
    settleSource(fetchJodiOilSnapshot),
    settleSource(fetchJodiGasSnapshot),
    settleSource(fetchFuelPriceHistory),
  ]);

  if (!annualResult.data) {
    if (cache) return cache.data;
    console.warn('[Oil] SDES unavailable — using latest consolidated SDES fallback (2024)');
    annualResult.data = FALLBACK_ANNUAL_STATS;
    annualResult.status = 'stale';
  }

  if (!originsResult.data || originsResult.data.length === 0) {
    originsResult.data = FALLBACK_ORIGINS;
    originsResult.status = originsResult.status === 'ok' ? 'stale' : originsResult.status;
  }

  const stocks = buildStocksSnapshot(annualResult.data, monthlyRowsResult.data);
  const flows = buildFlowsSnapshot(annualResult.data, deliveriesResult.data?.[0] ?? null);
  const { score, status } = computeVigilanceScore(stocks.nationalStocksDays, flows.trend);
  const harmonized = buildHarmonizedSnapshot(
    jodiOilResult.data,
    jodiGasResult.data,
    deliveriesResult.data?.[0] ?? null,
  );
  const freshness = buildFreshnessInfo(annualResult.data, deliveriesResult.data?.[0] ?? null, harmonized);

  const partialData = [
    annualResult.status,
    originsResult.status,
    deliveriesResult.status,
    monthlyRowsResult.status,
    localConsumptionResult.status,
    fuelPriceHistoryResult.status,
  ].some((sourceStatus) => sourceStatus !== 'ok');

  const dashboard: OilDashboard = {
    meta: {
      lastUpdate: new Date().toISOString(),
      vigilanceScore: score,
      status,
      partialData,
      freshness,
    },
    stocks,
    flows,
    origins: originsResult.data ?? [],
    deliveries: deliveriesResult.data ?? [],
    harmonized,
    fuelPriceHistory: fuelPriceHistoryResult.data,
    localConsumption: localConsumptionResult.data,
    refineries: OIL_REFINERIES.map((refinery) => ({ ...refinery })),
    depots: OIL_DEPOTS.map((depot) => ({ ...depot })),
    sourceStatus: {
      sdes: annualResult.status,
      insee: originsResult.status,
      cpdp: deliveriesResult.status,
      monthlyConsumption: monthlyRowsResult.status,
      localConsumption: localConsumptionResult.status,
      fuelPrices: fuelPriceHistoryResult.status,
      pipelines: 'ok',
    },
  };

  cache = {
    data: dashboard,
    fetchedAt: Date.now(),
  };

  const detail = `stocks ${dashboard.stocks.nationalStocksDays?.toFixed(0) ?? 'n.d.'}j · vigilance ${dashboard.meta.status}`;
  if (dashboard.meta.partialData) {
    Watchdog.report('oil-dashboard', { type: 'fallback', reason: `données partielles · ${detail}` });
  } else {
    Watchdog.report('oil-dashboard', { type: 'success', responseTimeMs: Date.now() - _t0, detail });
  }

  return dashboard;
}

export function clearOilCache(): void {
  cache = null;
}

export function getVigilanceLabel(status: OilVigilanceStatus): string {
  switch (status) {
    case 'critical':
      return 'Critique';
    case 'tense':
      return 'Sous tension';
    case 'normal':
      return 'Normal';
    default:
      return 'Inconnu';
  }
}

export function getVigilanceColor(status: OilVigilanceStatus): string {
  switch (status) {
    case 'critical':
      return '#ef4444';
    case 'tense':
      return '#f59e0b';
    case 'normal':
      return '#22c55e';
    default:
      return '#6b7280';
  }
}
