import type { SentinellesIndicator } from '../types/index.ts';

export interface SentinellesRssItem {
  title: string;
  link: string;
  pubDate?: string;
  semaine_epid?: string;
}

export interface SentinellesIngestionResult {
  sentinelles_last_week_available: string | null;
  rss_items: SentinellesRssItem[];
  indicators: SentinellesIndicator[];
}

const SENTINELLES_RSS_URL = 'https://www.sentiweb.fr/rss/fr/fr/html';
const SENTINELLES_INDICATORS_URL = 'https://www.sentiweb.fr/api/v1/datasets/rest/indicators';

const SENTINELLES_TARGETS = [
  { id: '3', label: 'Grippe', pathologie: 'Grippe' },
  { id: '25', label: 'IRA', pathologie: 'IRA' },
  { id: '7', label: 'Varicelle', pathologie: 'Varicelle' },
  { id: '6', label: 'Diarrhee aigue', pathologie: 'Diarrhee aigue' },
] as const;

function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1]) : '';
}

function normalizeWeek(raw: string): string | null {
  const compact = raw.match(/(\d{4})s?(\d{2})/i);
  if (compact) return `${compact[1]}-S${compact[2]}`;

  const dashed = raw.match(/(\d{4})-(\d{2})/);
  if (dashed) return `${dashed[1]}-S${dashed[2]}`;

  return null;
}

function parseRssItems(xml: string): SentinellesRssItem[] {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return items.map((match) => {
    const block = match[0];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate') || undefined;
    const semaine_epid = normalizeWeek(title) ?? normalizeWeek(link) ?? undefined;
    return { title, link, pubDate, semaine_epid };
  });
}

function csvSplit(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsvRows(text: string): Array<Record<string, string>> {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const delimiter = [';', ',', '\t']
    .map((candidate) => ({ candidate, score: csvSplit(lines[0], candidate).length }))
    .sort((a, b) => b.score - a.score)[0]?.candidate ?? ';';

  const headers = csvSplit(lines[0], delimiter).map((header) =>
    header
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, ''),
  );

  return lines.slice(1).map((line) => {
    const values = csvSplit(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? '').trim();
    });
    return row;
  });
}

function readNumber(row: Record<string, string>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = row[key];
    if (!raw) continue;
    const value = Number.parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function territoryLevelFromGeo(geo: string): SentinellesIndicator['territoire_niveau'] {
  if (geo === 'PAY') return 'nation';
  if (geo === 'REG') return 'region';
  return 'departement';
}

function territoryCodeFromRow(row: Record<string, string>): string {
  return row.geo_insee || row.geo_code || row.code_geo || row.dep || row.reg || 'FR';
}

function normalizeSentinellesRows(
  rows: Array<Record<string, string>>,
  pathologie: string,
  fallbackWeek: string | null,
): SentinellesIndicator[] {
  return rows
    .map((row) => {
      const incidence = readNumber(row, ['inc100', 'incidence', 'inc']);
      if (incidence == null) return null;

      const semaine_epid = normalizeWeek(row.week || row.semaine || '') ?? fallbackWeek;
      if (!semaine_epid) return null;

      const territoireGeo = row.geo || row.nivgeo || (row.geo_insee ? 'REG' : 'PAY');
      const indicator: SentinellesIndicator = {
        pathologie,
        semaine_epid,
        territoire_niveau: territoryLevelFromGeo(territoireGeo),
        territoire_code: territoryCodeFromRow(row),
        incidence,
        ic_low: readNumber(row, ['inc_low', 'ic_low', 'lower_ci']),
        ic_high: readNumber(row, ['inc_high', 'ic_high', 'upper_ci']),
        date_maj_source: new Date().toISOString(),
      };
      return indicator;
    })
    .filter((indicator): indicator is SentinellesIndicator => indicator !== null);
}

export async function parseSentinellesRss(fetcher: typeof fetch = fetch): Promise<SentinellesRssItem[]> {
  const response = await fetcher(SENTINELLES_RSS_URL, { headers: { Accept: 'application/rss+xml, application/xml' } });
  if (!response.ok) {
    throw new Error(`Sentinelles RSS HTTP ${response.status}`);
  }
  return parseRssItems(await response.text());
}

export async function identifyLatestSentinellesWeek(fetcher: typeof fetch = fetch): Promise<string | null> {
  const items = await parseSentinellesRss(fetcher);
  return items
    .map((item) => item.semaine_epid ?? null)
    .find((week): week is string => Boolean(week)) ?? null;
}

async function fetchSentinellesDatasetMap(fetcher: typeof fetch = fetch): Promise<Map<string, string>> {
  const response = await fetcher(SENTINELLES_INDICATORS_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Sentinelles indicators HTTP ${response.status}`);
  }

  const indicators = await response.json() as Array<{
    id?: string | number;
    datasets?: Array<{ id?: string; geo?: string }>;
  }>;

  const datasetMap = new Map<string, string>();
  for (const target of SENTINELLES_TARGETS) {
    const definition = indicators.find((indicator) => String(indicator.id ?? '') === target.id);
    const regionalDataset = definition?.datasets?.find((dataset) => dataset.geo === 'REG' && typeof dataset.id === 'string');
    if (regionalDataset?.id) {
      datasetMap.set(target.id, regionalDataset.id);
    }
  }
  return datasetMap;
}

export async function fetchSentinellesIndicators(fetcher: typeof fetch = fetch): Promise<SentinellesIngestionResult> {
  const [rssItems, datasetMap] = await Promise.all([
    parseSentinellesRss(fetcher),
    fetchSentinellesDatasetMap(fetcher),
  ]);

  const sentinelles_last_week_available =
    rssItems.map((item) => item.semaine_epid ?? null).find((week): week is string => Boolean(week)) ?? null;

  const blocks = await Promise.all(SENTINELLES_TARGETS.map(async (target) => {
    const datasetId = datasetMap.get(target.id);
    if (!datasetId) return [] as SentinellesIndicator[];

    const datasetUrl = `https://www.sentiweb.fr/api/v1/datasets/rest/dataset?id=${encodeURIComponent(datasetId)}&span=short&$format=json`;
    const response = await fetcher(datasetUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [] as SentinellesIndicator[];

    const payload = await response.json() as { data?: Array<Record<string, string>> };
    return normalizeSentinellesRows(payload.data ?? [], target.pathologie, sentinelles_last_week_available);
  }));

  return {
    sentinelles_last_week_available,
    rss_items: rssItems,
    indicators: blocks.flat(),
  };
}

export async function fetchSentinellesTableFromCsv(
  csvUrl: string,
  pathologie: string,
  fetcher: typeof fetch = fetch,
): Promise<SentinellesIndicator[]> {
  const response = await fetcher(csvUrl, { headers: { Accept: 'text/csv, text/plain' } });
  if (!response.ok) {
    throw new Error(`Sentinelles CSV HTTP ${response.status}`);
  }
  return normalizeSentinellesRows(parseCsvRows(await response.text()), pathologie, null);
}
