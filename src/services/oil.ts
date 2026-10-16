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
const FUEL_PRICE_SERIES_ENDPOINT = '/api/fuel-price-series';

/**
 * Chapitre pétrole des Chiffres clés de l'énergie (SDES). Depuis l'édition 2026 (30/09/2026), le chapitre est servi en
 * `12-petrole.php` ; l'ancienne adresse `fr/12-petrole` renvoie la page d'accueil (aucun chiffre). Essayées dans l'ordre.
 */
export const SDES_PETROLE_URLS: readonly string[] = [
  'https://www.statistiques.developpement-durable.gouv.fr/edition-numerique/chiffres-cles-energie/12-petrole.php',
  'https://www.statistiques.developpement-durable.gouv.fr/edition-numerique/chiffres-cles-energie/fr/12-petrole',
];
const INSEE_PETROLE_URL = 'https://www.insee.fr/fr/statistiques/2119697';
const UFIP_COMMUNIQUES_URL = 'https://www.energiesetmobilites.fr/presse/communiques';
const UFIP_SITE_ORIGIN = 'https://www.energiesetmobilites.fr';
const DATA_GOUV_LOCAL_DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/donnees-locales-de-consommation-de-produits-petroliers-departement-a-partir-de-2005/';
const DATA_GOUV_MONTHLY_DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/donnees-mensuelles-de-consommation-de-produits-petroliers-a-partir-de-2017/';
const JODI_OIL_BASE_URL = 'https://www.jodidata.org/_resources/files/downloads/oil-data/annual-csv';
const JODI_GAS_ZIP_URL = 'https://www.jodidata.org/jodi-publisher/gas/17/GAS_world_NewFormat.zip';
const JODI_GAS_ZIP_ENTRY = 'STAGING_world_NewFormat.csv';

let cache: OilCache | null = null;

// ─── Données de référence SDES/CPDP (dernier millésime consolidé) ────────────
// Utilisées comme fallback quand le scraping des pages vivantes échoue.
const FALLBACK_ANNUAL_STATS: AnnualOilStats = {
  year: 2025,
  crudeImportMtep: 46.9,
  refinedImportMtep: 34.5,
  refinedExportMtep: 17.5,
  refinedConsumptionMtep: 60,
  reserveMtep: 5.0,
  sourceLabel: 'SDES · Chiffres clés de l’énergie 2026 (données 2025)',
};

// Insee, provenance du brut importé, 2025 provisoire (paru le 21/05/2026).
const INSEE_2025 = 'Insee / SDES · Provenance du pétrole brut importé en France (2025 provisoire)';
const FALLBACK_ORIGINS: OilOriginShare[] = [
  { label: 'Afrique', sharePct: 36.6, volumeMt: 16.8, referenceYear: 2025, sourceLabel: INSEE_2025, partialBreakdown: true, breakdown: [] },
  { label: 'Amérique du Nord', sharePct: 23.1, volumeMt: 10.6, referenceYear: 2025, sourceLabel: INSEE_2025, partialBreakdown: true, breakdown: [] },
  { label: 'URSS/ex-URSS', sharePct: 15.6, volumeMt: 7.2, referenceYear: 2025, sourceLabel: INSEE_2025, partialBreakdown: true, breakdown: [] },
  { label: 'Mer du Nord', sharePct: 10.2, volumeMt: 4.7, referenceYear: 2025, sourceLabel: INSEE_2025, partialBreakdown: true, breakdown: [] },
  { label: 'Moyen-Orient', sharePct: 10.1, volumeMt: 4.6, referenceYear: 2025, sourceLabel: INSEE_2025, partialBreakdown: true, breakdown: [] },
  { label: 'Autres', sharePct: 4.4, volumeMt: 2.0, referenceYear: 2025, sourceLabel: INSEE_2025, partialBreakdown: false, breakdown: [] },
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

const OFFICIAL_FUEL_SERIES: Array<{
  fuelType: FuelPriceSeriesKey;
  label: string;
  color: string;
}> = [
  { fuelType: 'gazole', label: 'Gazole (B7)', color: '#F59E0B' },
  { fuelType: 'sp95', label: 'Super 95 (E5)', color: '#38BDF8' },
  { fuelType: 'sp98', label: 'Super 98 (E5)', color: '#F43F5E' },
  { fuelType: 'e10', label: 'E10', color: '#22C55E' },
  { fuelType: 'gpl', label: 'GPL', color: '#A78BFA' },
] as const;

type CachedFuelPriceSeriesPayload = {
  updatedAt?: string;
  source?: string;
  series?: Partial<Record<FuelPriceSeriesKey, Array<{ date?: string; avg?: number | null }>>>;
};

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
  const response = await fetch(FUEL_PRICE_SERIES_ENDPOINT, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Fuel price series cache returned HTTP ${response.status}`);
  }

  const payload = await response.json() as CachedFuelPriceSeriesPayload;
  const series = OFFICIAL_FUEL_SERIES.map((config): FuelPriceSeries => {
    const points = (payload.series?.[config.fuelType] ?? [])
      .map((point) => {
        if (typeof point.date !== 'string') return null;
        const price = point.avg === null ? Number.NaN : Number(point.avg);
        if (!Number.isFinite(price)) return null;
        return {
          timestamp: new Date(`${point.date.slice(0, 10)}T12:00:00.000Z`).toISOString(),
          price: Math.round(price * 1000) / 1000,
        };
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
  }).filter((entry) => entry.points.length > 0);

  if (series.length === 0) throw new Error('Fuel price series cache is empty');

  const timestamps = series.flatMap((entry) => entry.points.map((point) => point.timestamp)).sort();

  return {
    provider: 'data-economie',
    generatedAt: payload.updatedAt ?? new Date().toISOString(),
    sourceLabel: payload.source ?? 'prix-carburants-quotidien (MEF) + cache FranceMonitor',
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
    .replace(/m\s*<sup>\s*3(?:\s*&nbsp;)?\s*<\/sup>/gi, 'm3')
    .replace(/m\s*\^\s*\{\s*3\s*\}/gi, 'm3')
    .replace(/m\s+3\b/gi, 'm3')
    .replace(/<sup>3<\/sup>/gi, 'm3')
    .replace(/<sup>3 <\/sup>/gi, 'm3')
    .replace(/<sup>3<\/sup>/gi, 'm3')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isUfipMonthlyConsumptionTitle(title: string): boolean {
  const normalizedTitle = normalizeForMatch(title);
  return normalizedTitle.startsWith('la consommation francaise de produits petroliers energetiques')
    || normalizedTitle.startsWith('la consommation francaise de produits energetiques');
}

function stripUfipMonthlyConsumptionPrefix(title: string): string {
  return title.replace(
    /^La consommation française de produits (?:pétroliers )?énergétiques\s+/i,
    '',
  ).trim();
}

function parseFrenchPublicationDate(raw: string | undefined): number | null {
  if (!raw) return null;

  const normalized = normalizeForMatch(raw);
  const match = normalized.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!match) return null;

  const monthByName: Record<string, number> = {
    janvier: 0,
    fevrier: 1,
    mars: 2,
    avril: 3,
    mai: 4,
    juin: 5,
    juillet: 6,
    aout: 7,
    septembre: 8,
    octobre: 9,
    novembre: 10,
    decembre: 11,
  };

  const day = Number.parseInt(match[1], 10);
  const month = monthByName[match[2]];
  const year = Number.parseInt(match[3], 10);
  if (!Number.isFinite(day) || month == null || !Number.isFinite(year)) return null;

  return Date.UTC(year, month, day);
}

function resolveUfipUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, UFIP_SITE_ORIGIN).toString();
  } catch {
    return null;
  }
}

async function fetchOptionalUfipArticleText(href: string | undefined): Promise<string> {
  const resolvedUrl = resolveUfipUrl(href);
  if (!resolvedUrl) return '';

  try {
    const html = await fetchProxyText(resolvedUrl);
    return normalizeText(html);
  } catch (error) {
    console.warn('[Oil] UFIP detail fetch failed', resolvedUrl, error);
    return '';
  }
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


/** Nombre français : décimale facultative (« 60 Mtep » comme « 46,9 Mtep »). */
const MTEP = '([0-9]+(?:,[0-9]+)?)\\s*Mtep';

/** Chiffres annuels du chapitre pétrole du SDES. Les espaces de la page sont souvent insécables : `\\s`, jamais une espace. */
export function parseSdesOilStats(html: string): AnnualOilStats {
  const parsedYear = Number.parseInt(
    html.match(new RegExp(`Importations de pétrole brut[^]*?TOTAL\\s*:\\s*[0-9]+(?:,[0-9]+)?\\s*Mtep\\s+en\\s+(\\d{4})`, 'i'))?.[1] ?? '',
    10,
  );
  const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear() - 1;

  return {
    year,
    crudeImportMtep: extractFirstNumber(html, new RegExp(`Importations de pétrole brut[^]*?TOTAL\\s*:\\s*${MTEP}`, 'i'), 'SDES crude imports'),
    reserveMtep: extractFirstNumber(html, new RegExp(`réserves de pétrole brut\\s*\\(${MTEP}\\)`, 'i'), 'SDES reserves'),
    refinedImportMtep: extractFirstNumber(
      html,
      new RegExp(`importations de produits raffinés[^]*?contre\\s*${MTEP}\\s+en\\s+${year}[^]*?augmentation des exportations`, 'i'),
      'SDES refined imports',
    ),
    refinedExportMtep: extractFirstNumber(
      html,
      new RegExp(`exportations de ces produits[^]*?contre\\s*${MTEP}\\s+en\\s+${year}`, 'i'),
      'SDES refined exports',
    ),
    refinedConsumptionMtep: extractFirstNumber(html, new RegExp(`Consommation de produits raffinés[^]*?TOTAL\\s*:\\s*${MTEP}`, 'i'), 'SDES refined consumption'),
    sourceLabel: `SDES · Chiffres clés de l’énergie (données ${year})`,
  };
}

export async function fetchAnnualOilStatsFromSdes(): Promise<AnnualOilStats> {
  let lastError: unknown = null;
  for (const url of SDES_PETROLE_URLS) {
    try {
      return parseSdesOilStats(await fetchProxyText(url));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('SDES oil chapter unavailable');
}

export async function fetchOilOriginsFromInsee(): Promise<OilOriginShare[]> {
  return parseInseeOilOrigins(await fetchProxyText(INSEE_PETROLE_URL));
}

/**
 * Provenance du brut importé (Insee). Les volumes lus sont ceux de l'avant-dernière colonne (dernière année, en Mt), la part
 * celle de la dernière (en %) : l'année de référence est celle de la colonne lue, pas la première du tableau.
 */
export function parseInseeOilOrigins(html: string): OilOriginShare[] {
  const document = parseHtmlDocument(html);
  const rows = Array.from(document.querySelectorAll('#produit-tableau-figure1 tbody tr'));
  const headerCells = Array.from(document.querySelectorAll('#produit-tableau-figure1 thead th'));
  // En-têtes : Provenance, années…, dernière année en %. La colonne des volumes lus (5e valeur) est l'avant-dernière.
  const yearHeaders = headerCells.map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter((text) => /\d{4}/.test(text) && !/%/.test(text));
  const readHeader = yearHeaders[yearHeaders.length - 1] ?? '';
  const referenceYear = Number.parseInt(readHeader.match(/(\d{4})/)?.[1] ?? '', 10);
  const provisional = /\(p\)/i.test(readHeader);
  const sourceLabel = `Insee / SDES · Provenance du pétrole brut importé en France${Number.isFinite(referenceYear) ? ` (${referenceYear}${provisional ? ' provisoire' : ''})` : ''}`;

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

  const candidateArticles = articles
    .map((article) => {
      const titleLink = article.querySelector('h1.title a, h2.title a, h3.title a, .title a');
      const title = titleLink?.textContent?.trim() ?? '';
      if (!isUfipMonthlyConsumptionTitle(title)) {
        return null;
      }

      return {
        article,
        title,
        href: titleLink?.getAttribute('href') ?? undefined,
      };
    })
    .filter((entry): entry is { article: Element; title: string; href: string | undefined } => entry !== null);

  const deliveries = (await Promise.all(candidateArticles.map(async ({ article, title, href }) => {
    const bodyText = normalizeText(article.innerHTML);
    const detailText = await fetchOptionalUfipArticleText(href);
    const combinedText = `${bodyText} ${detailText}`.trim();
    const periodLabel = stripUfipMonthlyConsumptionPrefix(title);
    const publicationDate = article.querySelector('.date')?.textContent?.replace(/\s+/g, ' ').trim() ?? undefined;

    return {
      title,
      periodLabel,
      publicationDate,
      sourceLabel: 'UFIP Énergies et Mobilités · communiqué mensuel',
      roadFuelMillionM3: extractVolume(combinedText, /carburants routiers[^.]{0,220}?(?:volume de|pour atteindre|atteindre|atteignant|enregistr(?:ant|é) un volume de|s['’]établ(?:it|ies|is|issent) à)\s*([0-9]+,[0-9]+)\s*million(?:s)?\s+de(?:\s+de)?\s+m3/i),
      roadFuelYoYPct: extractSignedPercent(combinedText, /carburants routiers[^.]{0,220}?(hausse|augmentation|progression|baisse|repli|recul|baiss[ée]s?|augmentent|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
      totalProductsMillionTons: extractVolume(combinedText, /produits pétroliers énergétiques[^.]{0,320}?(?:s['’]établ(?:it|ies|is|issent) à|atteign(?:ent|ant|ait)|pour atteindre|à)\s*([0-9]+,[0-9]+)\s*million(?:s)?\s+de\s+tonnes/i),
      totalProductsYoYPct: extractSignedPercent(combinedText, /produits pétroliers énergétiques[^.]{0,220}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
      jetFuelMillionM3: extractVolume(combinedText, /carbur[ée]acteur[^.]{0,180}?à\s*([0-9]+,[0-9]+)\s*million(?:s)?\s+de\s+m3/i),
      jetFuelYoYPct: extractSignedPercent(combinedText, /carbur[ée]acteur[^.]{0,180}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
      gasoilYoYPct: extractSignedPercent(combinedText, /gazoles?[^.]{0,120}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse|baiss[ée]s?)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
      gasolineYoYPct: extractSignedPercent(combinedText, /supercarburants?[^.]{0,120}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
    } satisfies OilMonthlyDelivery;
  })))
    .sort((left, right) => {
      const rightTime = parseFrenchPublicationDate(right.publicationDate) ?? 0;
      const leftTime = parseFrenchPublicationDate(left.publicationDate) ?? 0;
      return rightTime - leftTime;
    })
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
    sourceLabel: `SDES / CPDP · données locales ${latestYear}`,
  };
}

export function computeVigilanceScore(stocksDays: number | null, deliveriesTrend: 'up' | 'down' | 'stable'): { score: number | null; status: OilVigilanceStatus } {
  // Sans stocks stratégiques connus, pas d'indice : aucune fausse tension vers le score et la note de situation.
  if (stocksDays === null) return { score: null, status: 'unknown' };
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

/**
 * Les « réserves de pétrole brut » du SDES sont le pétrole encore en gisement (≈ un mois de consommation), pas les stocks
 * stratégiques (obligation légale ≈ 90 jours, SAGESS / CPSSP) : on les expose pour ce qu'elles sont, et les stocks
 * stratégiques restent inconnus tant qu'aucune source publique n'est suivie (décision du 16/10/2026).
 */
export function buildStocksSnapshot(annual: AnnualOilStats): OilStocksSnapshot {
  return {
    date: `${annual.year}-12-31`,
    nationalStocksDays: null,
    totalStocksTons: null,
    byProduct: [],
    crudeReserveMtep: annual.reserveMtep,
    crudeReserveDays: Math.round((annual.reserveMtep / annual.refinedConsumptionMtep) * 365),
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
    console.warn('[Oil] SDES unavailable : using latest consolidated SDES fallback (2025)');
    annualResult.data = FALLBACK_ANNUAL_STATS;
    annualResult.status = 'stale';
  }

  if (!originsResult.data || originsResult.data.length === 0) {
    originsResult.data = FALLBACK_ORIGINS;
    originsResult.status = originsResult.status === 'ok' ? 'stale' : originsResult.status;
  }

  const stocks = buildStocksSnapshot(annualResult.data);
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
