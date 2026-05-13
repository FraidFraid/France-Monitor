import {
  fetchJson,
  fetchText,
  setCors,
} from '../_shared/health-utils.js';

const SENTINELLES_RSS_URL = 'https://www.sentiweb.fr/rss/fr/fr/html';
const SENTINELLES_INDICATORS_URL = 'https://www.sentiweb.fr/api/v1/datasets/rest/indicators';

const TARGETS = [
  { id: '3', pathologie: 'Grippe' },
  { id: '25', pathologie: 'IRA' },
  { id: '7', pathologie: 'Varicelle' },
  { id: '6', pathologie: 'Diarrhee aigue' },
];

function decodeXml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function normalizeWeek(raw) {
  const compact = String(raw || '').match(/(\d{4})s?(\d{2})/i);
  if (compact) return `${compact[1]}-S${compact[2]}`;
  const dashed = String(raw || '').match(/(\d{4})-(\d{2})/);
  if (dashed) return `${dashed[1]}-S${dashed[2]}`;
  return null;
}

function parseRssItems(xml) {
  return [...String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const block = match[0];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    return {
      title,
      link,
      pubDate: extractTag(block, 'pubDate') || null,
      semaine_epid: normalizeWeek(title) || normalizeWeek(link),
    };
  });
}

function readNumber(row, keys) {
  for (const key of keys) {
    const raw = row?.[key];
    if (raw == null || raw === '') continue;
    const value = Number.parseFloat(String(raw).replace(',', '.'));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function pickDatasetId(indicator) {
  const datasets = Array.isArray(indicator?.datasets) ? indicator.datasets : [];
  const preferred = datasets.find((dataset) => dataset?.geo === 'REG' && dataset?.id);
  return preferred?.id ? String(preferred.id) : null;
}

function normalizeIndicators(rows, pathologie, fallbackWeek) {
  return rows
    .map((row) => {
      const incidence = readNumber(row, ['inc100', 'incidence', 'inc']);
      if (incidence == null) return null;

      const week = normalizeWeek(row.week || row.semaine || '') || fallbackWeek;
      if (!week) return null;

      const geo = row.geo || row.nivgeo || (row.geo_insee ? 'REG' : 'PAY');
      return {
        pathologie,
        semaine_epid: week,
        territoire_niveau: geo === 'PAY' ? 'nation' : (geo === 'REG' ? 'region' : 'departement'),
        territoire_code: row.geo_insee || row.geo_code || row.code_geo || row.dep || row.reg || 'FR',
        incidence,
        ic_low: readNumber(row, ['inc_low', 'ic_low', 'lower_ci']),
        ic_high: readNumber(row, ['inc_high', 'ic_high', 'upper_ci']),
        date_maj_source: new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  try {
    const [rssXml, indicatorDefs] = await Promise.all([
      fetchText(SENTINELLES_RSS_URL, { timeoutMs: 12000 }),
      fetchJson(SENTINELLES_INDICATORS_URL, { timeoutMs: 12000 }),
    ]);

    const rssItems = parseRssItems(rssXml);
    const sentinelles_last_week_available =
      rssItems.map((item) => item.semaine_epid).find(Boolean) || null;

    const datasetMap = new Map();
    for (const target of TARGETS) {
      const definition = Array.isArray(indicatorDefs)
        ? indicatorDefs.find((indicator) => String(indicator?.id || '') === target.id)
        : null;
      const datasetId = pickDatasetId(definition);
      if (datasetId) datasetMap.set(target.id, datasetId);
    }

    const blocks = await Promise.all(TARGETS.map(async (target) => {
      const datasetId = datasetMap.get(target.id);
      if (!datasetId) return [];
      const datasetUrl = `https://www.sentiweb.fr/api/v1/datasets/rest/dataset?id=${encodeURIComponent(datasetId)}&span=short&$format=json`;
      try {
        const payload = await fetchJson(datasetUrl, { timeoutMs: 15000 });
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        return normalizeIndicators(rows, target.pathologie, sentinelles_last_week_available);
      } catch {
        return [];
      }
    }));

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    res.status(200).json({
      sentinelles_last_week_available,
      rss_items: rssItems,
      indicators: blocks.flat(),
      metadata: {
        generated_at: new Date().toISOString(),
        rss_url: SENTINELLES_RSS_URL,
      },
    });
  } catch (error) {
    console.error('[api/health/sentinelles-ingestion]', error);
    res.status(502).json({
      sentinelles_last_week_available: null,
      rss_items: [],
      indicators: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
