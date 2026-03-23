import {
  decodeHtmlEntities,
  fetchText,
  setCors,
  toIsoDate,
} from '../_shared/health-utils.js';

const ANSM_PAGE_URL = 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments';
const ANSM_EXPORT_URL = 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/export';

function stripHtmlTags(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '));
}

function mapStatus(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('rupture')) return 'rupture';
  if (v.includes('tension')) return 'tension';
  if (v.includes('remise')) return 'normalisation';
  return 'unknown';
}

function parseSpecialityAndDci(specialityRaw) {
  const speciality = stripHtmlTags(specialityRaw);
  const m = speciality.match(/^(.*)\s+\[([^\]]+)\]\s*$/);
  if (!m) {
    return { drug_name: speciality, dci: null };
  }
  return {
    drug_name: m[1].trim(),
    dci: m[2].trim().toUpperCase(),
  };
}

function parseAnsmRowsFromHtml(html) {
  const rows = [];

  const rowRegex = /<tr[^>]*class="[^"]*product-item[^"]*"[^>]*data-href="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const detailPath = match[1];
    const rowHtml = match[2];

    const tdMatches = [...rowHtml.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 4) continue;

    const statusText = stripHtmlTags(tdMatches[0][2]);
    const startDateRaw = stripHtmlTags(tdMatches[1][2]);
    const specialityRaw = tdMatches[2][2];

    const endDateAttr = /data-value="([^"]*)"/i.exec(tdMatches[3][1]);
    const expectedEndDate = toIsoDate(endDateAttr?.[1] || stripHtmlTags(tdMatches[3][2]));

    const { drug_name, dci } = parseSpecialityAndDci(specialityRaw);

    rows.push({
      drug_name,
      dci,
      status: mapStatus(statusText),
      start_date: toIsoDate(startDateRaw),
      expected_end_date: expectedEndDate,
      reason: statusText || null,
      alternatives: null,
      detail_url: detailPath ? `https://ansm.sante.fr${detailPath}` : null,
    });
  }

  return rows;
}

async function tryStructuredExport() {
  // ANSM exposes an XLS export endpoint. We attempt it first (structured source priority).
  // If parsing is not feasible in this runtime, caller will fallback to HTML table parsing.
  const resp = await fetch(ANSM_EXPORT_URL, {
    headers: { Accept: 'application/vnd.ms-excel, application/octet-stream;q=0.9, */*;q=0.8' },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    throw new Error(`ANSM export HTTP ${resp.status}`);
  }

  const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
  const fileName = String(resp.headers.get('content-disposition') || '');

  // No native XLS parser available here; just indicate structured source is reachable.
  return {
    reachable: true,
    content_type: contentType,
    content_disposition: fileName,
  };
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  const warnings = [];
  let structuredInfo = null;

  try {
    structuredInfo = await tryStructuredExport();
  } catch (err) {
    warnings.push(`Structured export unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const html = await fetchText(ANSM_PAGE_URL, { timeoutMs: 15000, headers: { Accept: 'text/html' } });
    const shortages = parseAnsmRowsFromHtml(html);

    const lastUpdate = shortages
      .map((s) => s.start_date)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null;

    if (shortages.length === 0) {
      warnings.push('ANSM table parsed but returned no rows.');
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
    res.status(200).json({
      shortages,
      last_update: lastUpdate,
      metadata: {
        generated_at: new Date().toISOString(),
        source: ANSM_PAGE_URL,
        structured_export: structuredInfo,
      },
      ...(warnings.length > 0 ? { warning: warnings.join(' | ') } : {}),
    });
  } catch (err) {
    console.error('[api/health/drug-shortages]', err);
    res.status(502).json({
      error: 'Failed to fetch ANSM drug shortages',
      details: err instanceof Error ? err.message : String(err),
      shortages: [],
      last_update: null,
      ...(warnings.length > 0 ? { warning: warnings.join(' | ') } : {}),
    });
  }
}
