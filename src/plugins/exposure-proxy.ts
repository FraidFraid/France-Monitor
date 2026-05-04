/**
 * exposure-proxy.ts — Vite Plugin (dev only)
 *
 * Endpoint local /api/exposure sans données synthétiques.
 * Sources live uniquement :
 * - Shodan InternetDB sans clé, sur un petit jeu de sentinelles FR publiques
 * - Shodan Search API si SHODAN_API_KEY est configurée
 * - Censys Search API si CENSYS_API_ID + CENSYS_API_SECRET sont configurées
 *
 * Si aucune source ne retourne de signal exploitable, la réponse est [].
 */

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface ThreatEvent {
  id: string;
  type: 'exposure';
  organizationName: string;
  domain?: string;
  location: { label: string; coordinates: [number, number]; precision: 'city' | 'region' | 'country' };
  severity: Severity;
  confidence: 'low';
  sector: string;
  date: string;
  summary: string;
  compromisedData: string[];
  metrics: { affectedAssets: number; sources: number };
  sources: { name: string; url: string; observedAt: string }[];
}

const FRENCH_CITIES: Record<string, [number, number]> = {
  paris: [2.3522, 48.8566],
  lyon: [4.8357, 45.764],
  marseille: [5.3698, 43.2965],
  strasbourg: [7.7521, 48.5734],
  roubaix: [3.1746, 50.6916],
};

const FR_SENTINEL_IPS = [
  { ip: '193.252.22.1', label: 'Orange France', city: 'Paris' },
  { ip: '80.10.246.1', label: 'Orange ADSL', city: 'Paris' },
  { ip: '90.41.0.1', label: 'SFR', city: 'Paris' },
  { ip: '89.92.0.1', label: 'Bouygues Telecom', city: 'Paris' },
  { ip: '176.160.0.1', label: 'Free SA', city: 'Paris' },
  { ip: '51.195.0.1', label: 'OVH Cloud', city: 'Roubaix' },
  { ip: '51.68.0.1', label: 'OVH Cloud', city: 'Strasbourg' },
  { ip: '51.159.0.1', label: 'Scaleway', city: 'Paris' },
  { ip: '195.221.0.1', label: 'RENATER', city: 'Paris' },
  { ip: '213.251.128.1', label: 'data.gouv.fr', city: 'Paris' },
];

function resolveGeo(city?: string, region?: string): ThreatEvent['location'] {
  if (city) {
    const key = city.toLowerCase().split(/[\s,-]+/)[0] ?? '';
    const coordinates = FRENCH_CITIES[key];
    if (coordinates) return { coordinates, label: city, precision: 'city' };
  }
  return { coordinates: [2.2137, 46.2276], label: region || 'France', precision: region ? 'region' : 'country' };
}

function inferSector(ports: number[] = [], hostnames: string[] = []): string {
  const text = [...ports.map(String), ...hostnames].join(' ').toLowerCase();
  if (text.includes('edu') || text.includes('univ') || text.includes('ac-')) return 'Education';
  if (text.includes('gouv') || text.includes('mairie') || text.includes('prefecture')) return 'Collectivites';
  if (text.includes('edf') || text.includes('rte') || text.includes('enedis')) return 'Energie';
  if ([502, 102, 44818, 20000, 47808].some((port) => ports.includes(port))) return 'Industrie/ICS';
  return 'Informatique';
}

function cveToSeverity(cves: string[]): Severity {
  if (cves.length === 0) return 'low';
  const criticals = new Set(['CVE-2021-44228', 'CVE-2021-34473', 'CVE-2022-26134', 'CVE-2023-44487', 'CVE-2021-26855']);
  if (cves.some((cve) => criticals.has(cve))) return 'critical';
  if (cves.length >= 5) return 'high';
  if (cves.length >= 2) return 'medium';
  return 'low';
}

function makeEvent(
  id: string,
  org: string,
  domain: string | undefined,
  geo: ThreatEvent['location'],
  sector: string,
  severity: Severity,
  summary: string,
  cves: string[],
  sources: ThreatEvent['sources'],
  affectedAssets: number,
): ThreatEvent {
  return {
    id,
    type: 'exposure',
    organizationName: org,
    domain,
    location: geo,
    severity,
    confidence: 'low',
    sector,
    date: new Date().toISOString(),
    summary,
    compromisedData: cves.slice(0, 5),
    metrics: { affectedAssets, sources: sources.length },
    sources,
  };
}

async function fetchShodanInternetDb(): Promise<ThreatEvent[]> {
  const now = new Date().toISOString();
  const results = await Promise.allSettled(
    FR_SENTINEL_IPS.slice(0, 8).map(async ({ ip, label, city }) => {
      const resp = await fetch(`https://internetdb.shodan.io/${ip}`, {
        headers: { 'User-Agent': 'FranceMonitor/1.0 OSINT-Research', Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as { cves?: string[]; ports?: number[]; hostnames?: string[] };
      return { data, ip, label, city };
    }),
  );

  const events: ThreatEvent[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { data, ip, label, city } = result.value;
    const cves = Array.isArray(data.cves) ? data.cves : [];
    const ports = Array.isArray(data.ports) ? data.ports : [];
    if (cves.length === 0 && ports.length === 0) continue;
    const hostnames = Array.isArray(data.hostnames) ? data.hostnames : [];
    const domain = hostnames[0]?.replace(/^www\./, '');
    const sector = inferSector(ports, hostnames);
    events.push(makeEvent(
      `shodan-internetdb-${ip.replace(/\./g, '-')}`,
      label,
      domain,
      resolveGeo(city),
      sector,
      cveToSeverity(cves),
      `Service expose detecte (${label}) via Shodan InternetDB. CVE: ${cves.slice(0, 3).join(', ') || 'aucune'}. Ports: ${ports.slice(0, 6).join(', ') || 'n/a'}. IP non divulguee.`,
      cves,
      [{ name: 'Shodan InternetDB', url: 'https://internetdb.shodan.io', observedAt: now }],
      1,
    ));
  }
  return events;
}

async function fetchShodanSearch(apiKey: string): Promise<ThreatEvent[]> {
  const infoResp = await fetch(`https://api.shodan.io/api-info?key=${apiKey}`, { signal: AbortSignal.timeout(5_000) });
  if (!infoResp.ok) return [];
  const info = await infoResp.json() as { query_credits?: number };
  if ((info.query_credits ?? 0) <= 0) return [];

  const events: ThreatEvent[] = [];
  const now = new Date().toISOString();
  const queries = [
    { q: 'country:FR port:3389 has_vuln:true', label: 'RDP expose avec CVE (FR)', sector: 'Multi-secteurs' },
    { q: 'country:FR product:"Microsoft Exchange" has_vuln:true', label: 'Exchange vulnerable (FR)', sector: 'Collectivites' },
    { q: 'country:FR port:502', label: 'ICS/SCADA Modbus expose (FR)', sector: 'Industrie/ICS' },
  ];

  for (const { q, label, sector } of queries.slice(0, Math.min(info.query_credits ?? 0, 3))) {
    const resp = await fetch(`https://api.shodan.io/shodan/host/search?key=${apiKey}&query=${encodeURIComponent(q)}&minify=true&page=1`, {
      headers: { 'User-Agent': 'FranceMonitor/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) continue;
    const data = await resp.json() as { total?: number };
    const total = data.total ?? 0;
    if (total <= 0) continue;
    events.push(makeEvent(
      `shodan-agg-${q.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      `${total} hotes France`,
      undefined,
      resolveGeo(),
      sector,
      total > 500 ? 'critical' : total > 100 ? 'high' : 'medium',
      `${label} - ${total} hotes exposes agreges en France via Shodan Search. Aucune IP divulguee.`,
      [],
      [{ name: 'Shodan Search API', url: 'https://shodan.io', observedAt: now }],
      total,
    ));
  }
  return events;
}

async function fetchCensys(apiId: string, apiSecret: string): Promise<ThreatEvent[]> {
  const auth = Buffer.from(`${apiId}:${apiSecret}`).toString('base64');
  const now = new Date().toISOString();
  const events: ThreatEvent[] = [];
  const queries = [
    { q: 'location.country_code="FR" AND services.service_name="REDIS"', label: 'Redis expose (FR)', sector: 'Informatique' },
    { q: 'location.country_code="FR" AND services.service_name="ELASTICSEARCH"', label: 'Elasticsearch expose (FR)', sector: 'Informatique' },
    { q: 'location.country_code="FR" AND services.service_name="MONGODB"', label: 'MongoDB expose (FR)', sector: 'Informatique' },
  ];

  for (const { q, label, sector } of queries) {
    const resp = await fetch('https://search.censys.io/api/v2/hosts/search', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'FranceMonitor/1.0',
      },
      body: JSON.stringify({ q, per_page: 1, virtual_hosts: 'INCLUDE' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) continue;
    const data = await resp.json() as { result?: { total?: number } };
    const total = data.result?.total ?? 0;
    if (total <= 0) continue;
    events.push(makeEvent(
      `censys-${q.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      `${total} hotes France`,
      undefined,
      resolveGeo(),
      sector,
      total > 500 ? 'critical' : total > 100 ? 'high' : total > 20 ? 'medium' : 'low',
      `${label} - ${total} services exposes en France via Censys. Donnees agregees, aucune IP divulguee.`,
      [],
      [{ name: 'Censys Search API', url: 'https://censys.io', observedAt: now }],
      total,
    ));
  }
  return events;
}

function dedup(events: ThreatEvent[]): ThreatEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.organizationName.toLowerCase()}-${event.sector}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function exposureProxyPlugin(): Plugin {
  return {
    name: 'exposure-proxy',
    configureServer(server) {
      server.middlewares.use('/api/exposure', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }

        const shodanKey = process.env.SHODAN_API_KEY || '';
        const censysId = process.env.CENSYS_API_ID || '';
        const censysSecret = process.env.CENSYS_API_SECRET || '';
        const active: string[] = [];

        try {
          const promises: Array<Promise<ThreatEvent[]>> = [
            fetchShodanInternetDb().then((events) => {
              active.push('shodan-internetdb');
              return events;
            }),
          ];

          if (shodanKey) {
            promises.push(fetchShodanSearch(shodanKey).then((events) => {
              active.push('shodan-search');
              return events;
            }));
          }

          if (censysId && censysSecret) {
            promises.push(fetchCensys(censysId, censysSecret).then((events) => {
              active.push('censys');
              return events;
            }));
          }

          const results = await Promise.allSettled(promises);
          const events = dedup(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []));

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=1800',
            'X-Sources-Active': active.join(','),
            'X-Event-Count': String(events.length),
          });
          res.end(JSON.stringify(events));
        } catch (err) {
          res.writeHead(502, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Exposure aggregation failed' }));
        }
      });
    },
  };
}
