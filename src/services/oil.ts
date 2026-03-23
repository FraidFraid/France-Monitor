import type {
  OilDashboard,
  OilFlowsSnapshot,
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

const SDES_PETROLE_URL = 'https://www.statistiques.developpement-durable.gouv.fr/edition-numerique/chiffres-cles-energie/fr/12-petrole';
const INSEE_PETROLE_URL = 'https://www.insee.fr/fr/statistiques/2119697';
const UFIP_COMMUNIQUES_URL = 'https://www.energiesetmobilites.fr/presse/communiques';
const DATA_GOUV_LOCAL_DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/donnees-locales-de-consommation-de-produits-petroliers-departement-a-partir-de-2005/';
const DATA_GOUV_MONTHLY_DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/donnees-mensuelles-de-consommation-de-produits-petroliers-a-partir-de-2017/';

let cache: OilCache | null = null;

// ─── Données de référence statiques (France, ~2022) ──────────────────────────
// Utilisées comme fallback quand les sources SDES/INSEE sont inaccessibles
const FALLBACK_ANNUAL_STATS: AnnualOilStats = {
  year: 2022,
  crudeImportMtep: 58.0,      // ~58 Mt pétrole brut importé/an
  refinedImportMtep: 12.0,    // ~12 Mt produits raffinés importés/an
  refinedExportMtep: 18.0,    // ~18 Mt produits raffinés exportés/an
  refinedConsumptionMtep: 73.0, // ~73 Mt consommation finale/an
  reserveMtep: 18.0,           // ~90 jours de réserves stratégiques
};

const FALLBACK_ORIGINS: OilOriginShare[] = [
  { label: 'Moyen-Orient', sharePct: 30, volumeMt: 17.4, referenceYear: 2022, sourceLabel: 'Données de référence (SDES)', partialBreakdown: false, breakdown: [] },
  { label: 'Afrique',      sharePct: 25, volumeMt: 14.5, referenceYear: 2022, sourceLabel: 'Données de référence (SDES)', partialBreakdown: false, breakdown: [] },
  { label: 'Mer du Nord',  sharePct: 20, volumeMt: 11.6, referenceYear: 2022, sourceLabel: 'Données de référence (SDES)', partialBreakdown: false, breakdown: [] },
  { label: 'URSS / Russie',sharePct: 10, volumeMt:  5.8, referenceYear: 2022, sourceLabel: 'Données de référence (SDES)', partialBreakdown: false, breakdown: [] },
  { label: 'Amériques',    sharePct: 15, volumeMt:  8.7, referenceYear: 2022, sourceLabel: 'Données de référence (SDES)', partialBreakdown: false, breakdown: [] },
];

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
    .map((article) => {
      const title = article.querySelector('h1.title a')?.textContent?.trim() ?? '';
      if (!title.toLowerCase().startsWith('la consommation française de produits énergétiques')) {
        return null;
      }

      const bodyText = normalizeText(article.innerHTML);
      const periodLabel = title.replace(/^La consommation française de produits énergétiques\s+/i, '').trim();

      return {
        title,
        periodLabel,
        roadFuelMillionM3: extractVolume(bodyText, /carburants routiers[^.]{0,220}?(?:volume de|s['’]établ(?:it|ies|is|issent) à)\s*([0-9]+,[0-9]+)\s*millions?\s+de(?:\s+de)?\s+m3/i),
        roadFuelYoYPct: extractSignedPercent(bodyText, /carburants routiers[^.]{0,220}?(hausse|augmentation|progression|baisse|repli|recul|baiss[ée]s?|augmentent|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
        totalProductsMillionTons: extractVolume(bodyText, /produits pétroliers énergétiques[^.]{0,260}?([0-9]+,[0-9]+)\s*millions?\s+de\s+tonnes/i),
        totalProductsYoYPct: extractSignedPercent(bodyText, /produits pétroliers énergétiques[^.]{0,220}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
        jetFuelMillionM3: extractVolume(bodyText, /carbur[ée]acteur[^.]{0,180}?à\s*([0-9]+,[0-9]+)\s*million(?:s)?\s+de\s+m3/i),
        jetFuelYoYPct: extractSignedPercent(bodyText, /carbur[ée]acteur[^.]{0,180}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
        gasoilYoYPct: extractSignedPercent(bodyText, /gazoles?[^.]{0,120}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse|baiss[ée]s?)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
        gasolineYoYPct: extractSignedPercent(bodyText, /supercarburants?[^.]{0,120}?(hausse|augmentation|repli|baisse|recul|en hausse|en baisse)[^0-9]{0,20}([0-9]+,[0-9]+)\s*%/i),
      } satisfies OilMonthlyDelivery;
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

export async function fetchOilDashboard(): Promise<OilDashboard> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.data;
  }

  const [
    annualResult,
    originsResult,
    deliveriesResult,
    monthlyRowsResult,
    localConsumptionResult,
  ] = await Promise.all([
    settleSource(fetchAnnualOilStatsFromSdes),
    settleSource(fetchOilOriginsFromInsee),
    settleSource(fetchMonthlyDeliveriesFromUfip),
    settleSource(fetchMonthlyOilConsumptionRows),
    settleSource(fetchLocalOilConsumption),
  ]);

  if (!annualResult.data) {
    if (cache) return cache.data;
    console.warn('[Oil] SDES unavailable — using static reference data (2022)');
    annualResult.data = FALLBACK_ANNUAL_STATS;
    annualResult.status = 'stale';
  }

  if (!originsResult.data || originsResult.data.length === 0) {
    originsResult.data = FALLBACK_ORIGINS;
  }

  const stocks = buildStocksSnapshot(annualResult.data, monthlyRowsResult.data);
  const flows = buildFlowsSnapshot(annualResult.data, deliveriesResult.data?.[0] ?? null);
  const { score, status } = computeVigilanceScore(stocks.nationalStocksDays, flows.trend);

  const partialData = [
    annualResult.status,
    originsResult.status,
    deliveriesResult.status,
    monthlyRowsResult.status,
    localConsumptionResult.status,
  ].some((sourceStatus) => sourceStatus !== 'ok');

  const dashboard: OilDashboard = {
    meta: {
      lastUpdate: new Date().toISOString(),
      vigilanceScore: score,
      status,
      partialData,
    },
    stocks,
    flows,
    origins: originsResult.data ?? [],
    deliveries: deliveriesResult.data ?? [],
    localConsumption: localConsumptionResult.data,
    refineries: OIL_REFINERIES.map((refinery) => ({ ...refinery })),
    depots: OIL_DEPOTS.map((depot) => ({ ...depot })),
    sourceStatus: {
      sdes: annualResult.status,
      insee: originsResult.status,
      ufip: deliveriesResult.status,
      monthlyConsumption: monthlyRowsResult.status,
      localConsumption: localConsumptionResult.status,
      pipelines: 'ok',
    },
  };

  cache = {
    data: dashboard,
    fetchedAt: Date.now(),
  };

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
