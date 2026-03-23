import {
  fetchJson,
  REGION_CODE_TO_NAME,
  resolveRegionCode,
  setCors,
} from '../_shared/health-utils.js';

const BASE = 'https://www.sentiweb.fr/api/v1/datasets/rest';
const SENTINELLES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const TARGET_INDICATORS = [
  { numericId: '3', code: 'grippe', label: 'Syndromes grippaux' },
  { numericId: '25', code: 'ira', label: 'Infections Resp. Aiguës (IRA)' },
  { numericId: '6', code: 'diarrhee', label: 'Diarrhées aiguës' },
  { numericId: '7', code: 'varicelle', label: 'Varicelle' },
  { numericId: '10', code: 'asthme', label: 'Crises d\'asthme' }
];

let sentinellesCache = null;

function pickDatasetId(indicatorDef) {
  const datasets = Array.isArray(indicatorDef?.datasets) ? indicatorDef.datasets : [];

  const candidates = datasets
    .filter((d) => d?.geo === 'REG')
    .sort((a, b) => {
      // Prefer legacy REG datasets first: they are stable with JSON output.
      const aScore = String(a?.id || '').includes('-ds2') ? 1 : 2;
      const bScore = String(b?.id || '').includes('-ds2') ? 1 : 2;
      return bScore - aScore;
    });

  return candidates[0]?.id || null;
}

function normalizeWeek(rawWeek) {
  const value = String(rawWeek || '');
  const m = value.match(/^(\d{4})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-W${m[2]}`;
}

async function fetchIndicatorDatasetMap() {
  const indicators = await fetchJson(`${BASE}/indicators`, { timeoutMs: 12000 });
  const list = Array.isArray(indicators) ? indicators : [];

  const out = new Map();
  for (const target of TARGET_INDICATORS) {
    const item = list.find((x) => String(x?.id) === target.numericId);
    const datasetId = item ? pickDatasetId(item) : null;
    if (datasetId) out.set(target.numericId, datasetId);
  }
  return out;
}

async function fetchDataset(datasetId) {
  const url = `${BASE}/dataset?id=${encodeURIComponent(datasetId)}&span=short&$format=json`;
  const payload = await fetchJson(url, { timeoutMs: 15000 });
  return Array.isArray(payload?.data) ? payload.data : [];
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  try {
    if (sentinellesCache && Date.now() - sentinellesCache.fetchedAt < SENTINELLES_CACHE_TTL_MS) {
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
      res.status(200).json({
        indicators: sentinellesCache.indicators,
        metadata: {
          generated_at: new Date(sentinellesCache.fetchedAt).toISOString(),
          source: 'Réseau Sentinelles / Sentiweb API',
          indicator_codes: TARGET_INDICATORS.map((x) => x.code),
          cached: true,
        },
      });
      return;
    }

    const datasetMap = await fetchIndicatorDatasetMap();

    const blocks = await Promise.all(
      TARGET_INDICATORS.map(async (target) => {
        const datasetId = datasetMap.get(target.numericId);
        if (!datasetId) return { target, rows: [] };

        try {
          const rawRows = await fetchDataset(datasetId);
          return { target, rows: rawRows };
        } catch {
          return { target, rows: [] };
        }
      })
    );

    const normalized = [];

    for (const block of blocks) {
      for (const row of block.rows) {
        const regionCode =
          resolveRegionCode(row.geo_insee) ||
          resolveRegionCode(row.geo_name);

        if (!regionCode) continue;

        const week = normalizeWeek(row.week);
        if (!week) continue;

        const incidence = Number.isFinite(Number(row.inc100))
          ? Number(row.inc100)
          : (Number.isFinite(Number(row.inc)) ? Number(row.inc) : null);

        if (incidence == null) continue;

        normalized.push({
          code: block.target.code,
          label: block.target.label,
          region_code: regionCode,
          region_name: REGION_CODE_TO_NAME[regionCode],
          week,
          incidence,
        });
      }
    }

    normalized.sort((a, b) => {
      if (a.week === b.week) {
        if (a.code === b.code) return a.region_code.localeCompare(b.region_code);
        return a.code.localeCompare(b.code);
      }
      return b.week.localeCompare(a.week);
    });

    if (normalized.length > 0) {
      sentinellesCache = {
        fetchedAt: Date.now(),
        indicators: normalized,
      };
    }

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    res.status(200).json({
      indicators: normalized,
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'Réseau Sentinelles / Sentiweb API',
        indicator_codes: TARGET_INDICATORS.map((x) => x.code),
        cached: false,
      },
    });
  } catch (err) {
    console.error('[api/health/sentinelles]', err);
    if (sentinellesCache?.indicators?.length) {
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
      res.status(200).json({
        indicators: sentinellesCache.indicators,
        metadata: {
          generated_at: new Date(sentinellesCache.fetchedAt).toISOString(),
          source: 'Réseau Sentinelles / Sentiweb API',
          indicator_codes: TARGET_INDICATORS.map((x) => x.code),
          cached: true,
          stale: true,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }

    res.status(502).json({
      error: 'Failed to fetch Sentinelles data',
      details: err instanceof Error ? err.message : String(err),
      indicators: [],
    });
  }
}
