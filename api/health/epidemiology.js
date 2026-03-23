import {
  fetchJson,
  fetchText,
  parseCsv,
  REGION_CODE_TO_NAME,
  resolveRegionCode,
  setCors,
  toIsoDate,
} from '../_shared/health-utils.js';

const DREES_DATASET_URLS = [
  'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/covid-19-resultats-regionaux-issus-des-appariements-entre-si-vic-si-dep-et-vac-s/records?limit=100&order_by=-date',
  'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/covid-19-resultats-regionaux-issus-des-appariements-entre-si-vic-si-dep-et-vac-si/records?limit=100&order_by=-date',
];

const SPF_ORG_DATASETS_URL =
  'https://www.data.gouv.fr/api/1/organizations/sante-publique-france/datasets/?page_size=40';

function pickNumber(row, keys) {
  for (const key of keys) {
    if (!(key in row)) continue;
    const value = Number.parseFloat(String(row[key]).replace(',', '.'));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function pickString(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const txt = String(value).trim();
    if (txt) return txt;
  }
  return '';
}

async function fetchDreesCovidRegional() {
  let payload = null;

  for (const url of DREES_DATASET_URLS) {
    try {
      payload = await fetchJson(url, { timeoutMs: 18000 });
      if (Array.isArray(payload?.results) && payload.results.length > 0) {
        break;
      }
    } catch {
      // try next mirror URL
    }
  }

  const rows = Array.isArray(payload?.results) ? payload.results : [];
  if (rows.length === 0) return [];

  const byRegion = new Map();

  for (const row of rows) {
    const regionCode =
      resolveRegionCode(row.reg) ||
      resolveRegionCode(row.region) ||
      resolveRegionCode(row.code_reg) ||
      resolveRegionCode(row.lib_reg);

    if (!regionCode) continue;

    const isoDate = toIsoDate(row.date);
    if (!isoDate) continue;

    const prev = byRegion.get(regionCode);
    if (prev && prev.date > isoDate) continue;

    byRegion.set(regionCode, {
      region_code: regionCode,
      region_name: REGION_CODE_TO_NAME[regionCode] || pickString(row, ['region', 'lib_reg']) || `Région ${regionCode}`,
      date: isoDate,
      incidence: pickNumber(row, ['incidence', 'tx_incidence', 'nb_pcr', 'nb_pcr_sympt']),
      hospitalisations: pickNumber(row, ['hc', 'hosp', 'hospitalisations']),
      reanimation: pickNumber(row, ['sc', 'rea', 'reanimation']),
      deces: pickNumber(row, ['dc', 'deces', 'deaths']),
    });
  }

  return [...byRegion.values()].sort((a, b) => a.region_code.localeCompare(b.region_code));
}

function selectSpfCandidateResources(datasets) {
  const candidates = [];

  for (const ds of datasets) {
    const title = String(ds?.title || '').toLowerCase();
    const resources = Array.isArray(ds?.resources) ? ds.resources : [];

    for (const r of resources) {
      const url = String(r?.url || '');
      if (!url) continue;
      const format = String(r?.format || '').toLowerCase();

      // Priorité à des ressources régionales lisibles (csv/json)
      const isRegional = /(?:^|[-_\/])(reg|region)(?:[-_\/]|$)/i.test(url) || /\breg\b/i.test(String(r?.title || ''));
      const isStructured = format.includes('csv') || format.includes('json') || /\.csv(?:\?|$)/i.test(url) || /\.json(?:\?|$)/i.test(url);
      if (!isRegional || !isStructured) continue;

      const score =
        (title.includes('urgences') ? 4 : 0) +
        (title.includes('sos') ? 3 : 0) +
        (title.includes('epidem') ? 2 : 0) +
        (title.includes('covid') ? 1 : 0);

      candidates.push({
        datasetId: ds.id,
        datasetTitle: ds.title,
        resourceTitle: r.title,
        url,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  // Keep at most two distinct datasets to limit upstream load.
  const selected = [];
  const usedDatasetIds = new Set();
  for (const c of candidates) {
    if (usedDatasetIds.has(c.datasetId)) continue;
    selected.push(c);
    usedDatasetIds.add(c.datasetId);
    if (selected.length >= 2) break;
  }

  return selected;
}

function normalizeSpfRecords(rows, datasetLabel) {
  const out = [];
  for (const row of rows) {
    const regionCode = resolveRegionCode(
      pickString(row, ['reg', 'region', 'code_reg', 'region_code', 'lib_reg', 'nom_reg', 'nom_region'])
    );

    if (!regionCode) continue;

    const isoDate = toIsoDate(
      pickString(row, ['date', 'jour', 'date_de_passage', 'date_extract', 'week', 'semaine'])
    );

    const metric = pickString(row, ['indicator', 'indicateur', 'pathologie', 'lib_indicateur']) || datasetLabel;

    const value = pickNumber(row, [
      'incidence', 'tx_incidence',
      'nbre_pass_corona', 'nbre_hospit_corona',
      'tx_passages_covid', 'tx_hospit_covid',
      'nbre_acte_corona', 'nbre_pass_total', 'nb',
      'value', 'valeur',
    ]);

    if (value == null && !isoDate) continue;

    out.push({
      region_code: regionCode,
      region_name: REGION_CODE_TO_NAME[regionCode],
      date: isoDate,
      metric,
      value,
    });
  }

  // Keep only the most recent points per region to limit payload.
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out.slice(0, 300);
}

async function fetchSpfExtraIndicators() {
  try {
    const org = await fetchJson(SPF_ORG_DATASETS_URL, { timeoutMs: 16000 });
    const datasets = Array.isArray(org?.data) ? org.data : [];
    const selected = selectSpfCandidateResources(datasets);

    const bundles = await Promise.all(selected.map(async (sel) => {
      const txt = await fetchText(sel.url, { timeoutMs: 16000 });

      let rows;
      if (/\.json(?:\?|$)/i.test(sel.url)) {
        const parsed = JSON.parse(txt);
        rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.results) ? parsed.results : []);
      } else {
        rows = parseCsv(txt);
      }

      return {
        keyHint: `${sel.datasetTitle} ${sel.resourceTitle}`.toLowerCase(),
        dataset_id: sel.datasetId,
        dataset_title: sel.datasetTitle,
        resource_title: sel.resourceTitle,
        records: normalizeSpfRecords(rows, sel.resourceTitle || sel.datasetTitle),
      };
    }));

    const urgences = bundles.find((b) => /urgences/.test(b.keyHint)) || bundles[0];
    const autres = bundles.find((b) => b !== urgences) || null;

    return {
      urgences_grippe: urgences?.records || [],
      autres_pathologies: autres?.records || [],
      sources: bundles.map((b) => ({
        dataset_id: b.dataset_id,
        dataset_title: b.dataset_title,
        resource_title: b.resource_title,
        points: b.records.length,
      })),
    };
  } catch {
    return {
      urgences_grippe: [],
      autres_pathologies: [],
      sources: [],
    };
  }
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  try {
    const [covidRegional, extra] = await Promise.all([
      fetchDreesCovidRegional(),
      fetchSpfExtraIndicators(),
    ]);

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    res.status(200).json({
      covid_regional: covidRegional,
      extra_indicators: {
        urgences_grippe: extra.urgences_grippe,
        autres_pathologies: extra.autres_pathologies,
      },
      metadata: {
        generated_at: new Date().toISOString(),
        source_notes: [
          'DREES régional: indicateurs hospitaliers et virologiques (SI-VIC/SI-DEP/VAC-SI).',
          'SPF via data.gouv: ressources régionales sélectionnées automatiquement.',
        ],
        spf_sources: extra.sources,
      },
    });
  } catch (err) {
    console.error('[api/health/epidemiology]', err);
    res.status(502).json({
      error: 'Failed to fetch epidemiology data',
      details: err instanceof Error ? err.message : String(err),
      covid_regional: [],
      extra_indicators: {
        urgences_grippe: [],
        autres_pathologies: [],
      },
    });
  }
}
