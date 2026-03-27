import type { Plugin } from 'vite';

interface DataGouvDataset {
  id?: string;
  title?: string;
}

interface DataGouvDatasetSearchResponse {
  data?: DataGouvDataset[];
}

interface DataGouvDatasetDetailsResponse {
  resources?: Array<{
    title?: string;
    format?: string;
    url?: string;
  }>;
}

interface SentiIndicatorDef {
  id?: string | number;
  name?: string;
  datasets?: Array<{ id?: string; geo?: string }>;
}

function buildDataGouvSearchUrl(): string {
  const q = encodeURIComponent('Santé Publique France indicateurs épidémiologiques région');
  return `https://www.data.gouv.fr/api/1/datasets/?q=${q}&page_size=6`;
}

const PRIMARY_HEALTH_REGIONAL_URL =
  'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/' +
  'covid-19-resultats-regionaux-issus-des-appariements-entre-si-vic-si-dep-et-vac-s/records' +
  '?limit=100&order_by=-date';

function normalizeResourceUrl(url: string): string {
  if (url.includes('api/explore/v2.1/catalog/datasets/') && !url.includes('/records')) {
    return `${url.replace(/\/$/, '')}/records?limit=400`;
  }
  return url;
}

async function fetchSantePubliqueRows(): Promise<Record<string, unknown>[]> {
  // Primary source: explicit regional dataset with hospital indicators.
  try {
    const primaryResp = await fetch(PRIMARY_HEALTH_REGIONAL_URL, { signal: AbortSignal.timeout(20_000) });
    if (primaryResp.ok) {
      const primaryJson = await primaryResp.json() as { results?: Record<string, unknown>[] };
      if (Array.isArray(primaryJson.results) && primaryJson.results.length > 0) {
        return primaryJson.results;
      }
    }
  } catch {
    // Continue with generic discovery fallback
  }

  const searchResp = await fetch(buildDataGouvSearchUrl(), { signal: AbortSignal.timeout(10_000) });
  if (!searchResp.ok) throw new Error(`data.gouv search HTTP ${searchResp.status}`);
  const searchJson = await searchResp.json() as DataGouvDatasetSearchResponse;
  const datasets = Array.isArray(searchJson.data) ? searchJson.data : [];
  if (datasets.length === 0) return [];

  const dataset = datasets.find((d) => /sant[eé] publique/i.test(d.title ?? '')) ?? datasets[0];
  const datasetId = dataset.id;
  if (!datasetId) return [];

  const detailsUrl = `https://www.data.gouv.fr/api/1/datasets/${datasetId}/`;
  const detailsResp = await fetch(detailsUrl, { signal: AbortSignal.timeout(10_000) });
  if (!detailsResp.ok) throw new Error(`dataset details HTTP ${detailsResp.status}`);

  const detailsJson = await detailsResp.json() as DataGouvDatasetDetailsResponse;
  const resources = Array.isArray(detailsJson.resources) ? detailsJson.resources : [];
  const candidates = resources
    .filter((r) => typeof r.url === 'string')
    .sort((a, b) => {
      const aScore = /api\/explore|json/i.test(`${a.url} ${a.format ?? ''}`) ? 1 : 0;
      const bScore = /api\/explore|json/i.test(`${b.url} ${b.format ?? ''}`) ? 1 : 0;
      return bScore - aScore;
    });

  for (const resource of candidates) {
    try {
      const resourceUrl = normalizeResourceUrl(String(resource.url));
      const resp = await fetch(resourceUrl, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) continue;
      const json = await resp.json() as { results?: Record<string, unknown>[]; records?: Record<string, unknown>[]; data?: Record<string, unknown>[] };
      const rows = Array.isArray(json)
        ? (json as Record<string, unknown>[])
        : Array.isArray(json.results)
          ? json.results
          : Array.isArray(json.records)
            ? json.records
            : Array.isArray(json.data)
              ? json.data
              : [];
      if (rows.length > 0) return rows;
    } catch {
      // Try next resource
    }
  }

  return [];
}

async function fetchOpenAccessMonitorCount(): Promise<number> {
  const url = 'https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets?limit=1&q=sante';
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) return 0;
    const json = await resp.json() as { total_count?: number };
    return typeof json.total_count === 'number' ? json.total_count : 0;
  } catch {
    return 0;
  }
}

const SENTI_BASE = 'https://www.sentiweb.fr/api/v1/datasets/rest';
const SENTINELLES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const SENTI_TARGETS = [
  { id: '3', code: 'grippe', label: 'Syndromes grippaux' },
  { id: '6', code: 'diarrhee', label: 'Diarrhées aiguës' },
  { id: '7', code: 'varicelle', label: 'Varicelle' },
  { id: '10', code: 'asthme', label: 'Crises d\'asthme' },
  { id: '25', code: 'ira', label: 'Infections Resp. Aiguës (IRA)' }
];

let sentinellesCache: {
  fetchedAt: number;
  indicators: Array<{
    code: string;
    label: string;
    region_code: string;
    region_name: string;
    week: string;
    incidence: number;
  }>;
} | null = null;

const SENTI_REGION_ALIAS_TO_CODE: Record<string, string | null> = {
  ALSACE: '44',
  CHAMPAGNEARDENNE: '44',
  LORRAINE: '44',
  AQUITAINE: '75',
  LIMOUSIN: '75',
  POITOUCHARENTES: '75',
  AUVERGNE: '84',
  RHONEALPES: '84',
  BASSENORMANDIE: '28',
  HAUTENORMANDIE: '28',
  BOURGOGNE: '27',
  FRANCHECOMTE: '27',
  LANGUEDOCROUSSILLON: '76',
  MIDIPYRENEES: '76',
  NORDPASDECALAIS: '32',
  PICARDIE: '32',
  PROVENCEALPESCOTEDAZUR: '93',
  PAYSDELALOIRE: '52',
  BRETAGNE: '53',
  CENTRE: '24',
  CORSE: '94',
  ILEDEFRANCE: '11',
  OUTREMER: null,
};

function normalizeRegionKey(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

function sentiRegionToCode(rawName: string): string | null {
  const key = normalizeRegionKey(rawName);
  return SENTI_REGION_ALIAS_TO_CODE[key] ?? null;
}

async function fetchSentinellesIndicators(): Promise<Array<{
  code: string;
  label: string;
  region_code: string;
  region_name: string;
  week: string;
  incidence: number;
}>> {
  if (sentinellesCache && Date.now() - sentinellesCache.fetchedAt < SENTINELLES_CACHE_TTL_MS) {
    return sentinellesCache.indicators;
  }

  const defs = await fetch(`${SENTI_BASE}/indicators`, { signal: AbortSignal.timeout(12_000) })
    .then((r) => r.ok ? r.json() as Promise<SentiIndicatorDef[]> : Promise.resolve([] as SentiIndicatorDef[]))
    .catch(() => [] as SentiIndicatorDef[]);

  const datasetMap = new Map<string, string>();
  for (const target of SENTI_TARGETS) {
    const indicator = defs.find((d) => String(d.id ?? '') === target.id);
    const ds = (indicator?.datasets ?? [])
      .filter((d) => d.geo === 'REG' && !String(d.id ?? '').includes('-ds2'))
      .map((d) => String(d.id ?? ''))[0];
    if (ds) datasetMap.set(target.id, ds);
  }

  const blocks = await Promise.all(SENTI_TARGETS.map(async (target) => {
    const datasetId = datasetMap.get(target.id);
    if (!datasetId) return [];
    const url = `${SENTI_BASE}/dataset?id=${encodeURIComponent(datasetId)}&span=short&$format=json`;
    const payload = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      .then((r) => r.ok ? r.json() as Promise<{ data?: Array<Record<string, unknown>> }> : Promise.resolve({ data: [] }))
      .catch(() => ({ data: [] }));
    const rows = Array.isArray(payload.data) ? payload.data : [];

    return rows.map((row) => {
      const weekRaw = String(row.week ?? '');
      const m = weekRaw.match(/^(\d{4})(\d{2})$/);
      const week = m ? `${m[1]}-W${m[2]}` : weekRaw;
      const regionName = String(row.geo_name ?? '').trim();
      const regionCode = sentiRegionToCode(regionName);
      const incidence = Number.parseFloat(String(row.inc100 ?? row.inc ?? 'NaN'));
      if (!regionCode || !week || !Number.isFinite(incidence)) return null;
      return {
        code: target.code,
        label: target.label,
        region_code: regionCode,
        region_name: regionName,
        week,
        incidence,
      };
    }).filter((v): v is {
      code: string;
      label: string;
      region_code: string;
      region_name: string;
      week: string;
      incidence: number;
    } => v !== null);
  }));

  const indicators = blocks.flat();

  if (indicators.length > 0) {
    sentinellesCache = {
      fetchedAt: Date.now(),
      indicators,
    };
  }

  return indicators;
}

function decodeHtml(input: string): string {
  return input
    .replace(/&#0*39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(input: string): string {
  return decodeHtml(String(input || '').replace(/<[^>]+>/g, ' '));
}

function toIsoDate(raw: string): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const ymd = text.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  return null;
}

async function fetchAnsmShortages(): Promise<{ shortages: Array<Record<string, unknown>>; last_update: string | null }> {
  const html = await fetch('https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments', {
    signal: AbortSignal.timeout(15_000),
  }).then((r) => r.ok ? r.text() : Promise.resolve(''));

  const shortages: Array<Record<string, unknown>> = [];
  const rowRegex = /<tr[^>]*class="[^"]*product-item[^"]*"[^>]*data-href="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(html)) !== null) {
    const detailPath = m[1];
    const tds = [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (tds.length < 4) continue;
    const statusText = stripTags(tds[0][2]);
    const startDate = toIsoDate(stripTags(tds[1][2]));
    const speciality = stripTags(tds[2][2]);
    const dciMatch = speciality.match(/^(.*)\s+\[([^\]]+)\]\s*$/);
    const drugName = dciMatch ? dciMatch[1].trim() : speciality;
    const dci = dciMatch ? dciMatch[2].trim().toUpperCase() : null;
    const endAttr = /data-value="([^"]*)"/i.exec(tds[3][1]);
    const expectedEndDate = toIsoDate(endAttr?.[1] ?? stripTags(tds[3][2]));
    const status = statusText.toLowerCase().includes('rupture') ? 'rupture'
      : statusText.toLowerCase().includes('tension') ? 'tension'
        : statusText.toLowerCase().includes('remise') ? 'normalisation'
          : 'unknown';

    shortages.push({
      drug_name: drugName,
      dci,
      status,
      start_date: startDate,
      expected_end_date: expectedEndDate,
      reason: statusText,
      alternatives: null,
      detail_url: detailPath ? `https://ansm.sante.fr${detailPath}` : null,
    });
  }

  const lastUpdate = shortages
    .map((s) => String(s.start_date ?? ''))
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  return { shortages, last_update: lastUpdate };
}

export function healthProxyPlugin(): Plugin {
  return {
    name: 'health-proxy',
    configureServer(server) {
      server.middlewares.use('/api/health/epidemiology', async (_req, res) => {
        try {
          const [rows, openAccessMonitorCount] = await Promise.all([
            fetchSantePubliqueRows(),
            fetchOpenAccessMonitorCount(),
          ]);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=900');
          res.end(JSON.stringify({ rows, openAccessMonitorCount }));
        } catch (err) {
          console.error('[health-proxy]', err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Health proxy failed', rows: [], openAccessMonitorCount: 0 }));
        }
      });

      server.middlewares.use('/api/health/sentinelles', async (_req, res) => {
        try {
          const indicators = await fetchSentinellesIndicators();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=21600');
          res.end(JSON.stringify({
            indicators,
            metadata: {
              generated_at: new Date().toISOString(),
              source: 'Réseau Sentinelles / Sentiweb API',
              cached: sentinellesCache !== null,
            },
          }));
        } catch (err) {
          console.error('[health-proxy/sentinelles]', err);
          if (sentinellesCache?.indicators.length) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=900');
            res.end(JSON.stringify({
              indicators: sentinellesCache.indicators,
              metadata: {
                generated_at: new Date(sentinellesCache.fetchedAt).toISOString(),
                source: 'Réseau Sentinelles / Sentiweb API',
                cached: true,
                stale: true,
                error: err instanceof Error ? err.message : 'Sentinelles proxy failed',
              },
            }));
            return;
          }

          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Sentinelles proxy failed', indicators: [] }));
        }
      });

      server.middlewares.use('/api/health/epidemic-alerts', async (_req, res) => {
        try {
          const mod = await import('../../api/health/epidemic-alerts.js');
          const fakeReq = { method: 'GET' };
          const fakeRes = {
            statusCode: 200,
            _headers: {} as Record<string, string>,
            _body: '',
            setHeader(k: string, v: string) { this._headers[k] = v; },
            status(code: number) { this.statusCode = code; return this; },
            json(data: unknown) { this._body = JSON.stringify(data); },
            end() { },
          };
          await mod.default(fakeReq, fakeRes);
          res.statusCode = fakeRes.statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.end(fakeRes._body);
        } catch (err) {
          console.error('[health-proxy/epidemic-alerts]', err);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ alerts: [], metadata: { generated_at: new Date().toISOString() } }));
        }
      });

      server.middlewares.use('/api/health/drug-shortages', async (_req, res) => {
        try {
          const data = await fetchAnsmShortages();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=1800');
          res.end(JSON.stringify(data));
        } catch (err) {
          console.error('[health-proxy/drug-shortages]', err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'ANSM proxy failed', shortages: [], last_update: null }));
        }
      });

      // Departmental data — proxy to the Vercel handler in dev
      server.middlewares.use('/api/health/departmental', async (_req, res) => {
        try {
          // In dev, dynamically import the handler
          const mod = await import('../../api/health/departmental.js');
          const fakeReq = { method: 'GET' };
          const fakeRes = {
            statusCode: 200,
            _headers: {} as Record<string, string>,
            _body: '',
            setHeader(k: string, v: string) { this._headers[k] = v; },
            status(code: number) { this.statusCode = code; return this; },
            json(data: unknown) { this._body = JSON.stringify(data); },
            end() { },
          };
          await mod.default(fakeReq, fakeRes);
          res.statusCode = fakeRes.statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=900');
          res.end(fakeRes._body);
        } catch (err) {
          console.error('[health-proxy/departmental]', err);
          // Fallback: return empty departmental data so the service degrades gracefully
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ departments: [], metadata: { generated_at: new Date().toISOString(), total_departments: 0, sources: {} } }));
        }
      });

      server.middlewares.use('/api/health/oscour-sos', async (_req, res) => {
        try {
          const mod = await import('../../api/health/oscour-sos.js');
          const fakeReq = { method: 'GET' };
          const fakeRes = {
            statusCode: 200,
            _headers: {} as Record<string, string>,
            _body: '',
            setHeader(k: string, v: string) { this._headers[k] = v; },
            status(code: number) { this.statusCode = code; return this; },
            json(data: unknown) { this._body = JSON.stringify(data); },
            end() { },
          };
          await mod.default(fakeReq, fakeRes);
          res.statusCode = fakeRes.statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=1800');
          res.end(fakeRes._body);
        } catch (err) {
          console.error('[health-proxy/oscour-sos]', err);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ departements: [], metadata: { generated_at: new Date().toISOString() } }));
        }
      });

      server.middlewares.use('/api/health/apl', async (_req, res) => {
        try {
          const mod = await import('../../api/health/apl.js');
          const fakeReq = { method: 'GET' };
          const fakeRes = {
            statusCode: 200,
            _headers: {} as Record<string, string>,
            _body: '',
            setHeader(k: string, v: string) { this._headers[k] = v; },
            status(code: number) { this.statusCode = code; return this; },
            json(data: unknown) { this._body = JSON.stringify(data); },
            end() { },
          };
          await mod.default(fakeReq, fakeRes);
          res.statusCode = fakeRes.statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.end(fakeRes._body);
        } catch (err) {
          console.error('[health-proxy/apl]', err);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ departements: [], metadata: { generated_at: new Date().toISOString() } }));
        }
      });
    },
  };
}
