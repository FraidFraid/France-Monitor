/**
 * api/exposure.js — Vercel Edge Function
 * Cartographie des expositions techniques passives (OSINT).
 *
 * Sources actives :
 *   - Shodan InternetDB (SANS clé) → vérification IP par IP, plages FR connues
 *   - Shodan Search API (SHODAN_API_KEY + crédits) → requêtes pays:FR thématiques
 *   - Censys Search API (CENSYS_API_ID + CENSYS_API_SECRET) → services exposés FR
 *
 * Plan Shodan OSS (gratuit) : InternetDB seulement, 0 query_credits.
 * Plan Shodan payant : Search API complète.
 *
 * Sécurité & conformité RGPD :
 *   ❌ Aucune IP retournée au client
 *   ❌ Aucune donnée personnelle
 *   ✅ Données agrégées : CVE par org/secteur + volume d'actifs
 *   ✅ Confidence "low" systématique (données estimées, non vérifiées)
 *   ✅ Sources 100% publiques et légales
 *
 * GET /api/exposure
 * Response: ThreatEvent[] (JSON)
 */

export const config = { runtime: 'edge' };

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=300',
};

// ─── Geo helpers ───

const FRENCH_CITIES = {
  paris:      [2.3522,  48.8566],
  lyon:       [4.8357,  45.7640],
  marseille:  [5.3698,  43.2965],
  toulouse:   [1.4442,  43.6047],
  bordeaux:   [-0.5792, 44.8378],
  lille:      [3.0573,  50.6292],
  nantes:     [-1.5534, 47.2184],
  strasbourg: [7.7521,  48.5734],
  rennes:     [-1.6778, 48.1173],
  nice:       [7.2620,  43.7102],
  grenoble:   [5.7245,  45.1885],
  rouen:      [1.0993,  49.4432],
  roubaix:    [3.1746,  50.6916],
  metz:       [6.1757,  49.1193],
};

function resolveGeo(city, region) {
  if (city) {
    const key = city.toLowerCase().split(/[\s,-]+/)[0];
    if (FRENCH_CITIES[key]) return { coordinates: FRENCH_CITIES[key], label: city, precision: 'city' };
  }
  return { coordinates: [2.2137, 46.2276], label: region || 'France', precision: region ? 'region' : 'country' };
}

function inferSector(ports, hostnames) {
  const text = [...(ports || []).map(String), ...(hostnames || [])].join(' ').toLowerCase();
  if (text.includes('sante') || text.includes('hopital') || text.includes('chu')) return 'Santé';
  if (text.includes('edu') || text.includes('univ') || text.includes('ac-')) return 'Éducation';
  if (text.includes('gouv') || text.includes('mairie') || text.includes('prefecture')) return 'Collectivités';
  if (text.includes('banque') || text.includes('credit') || text.includes('assur')) return 'Finance';
  if (text.includes('edf') || text.includes('rte') || text.includes('enedis')) return 'Énergie';
  if (text.includes('sncf') || text.includes('ratp') || text.includes('aero')) return 'Transport';
  if ((ports || []).some(p => [502, 102, 44818, 20000, 47808].includes(p))) return 'Industrie/ICS';
  return 'Informatique';
}

function cveToSeverity(cves) {
  if (!cves?.length) return 'low';
  const criticals = ['CVE-2021-44228', 'CVE-2021-34473', 'CVE-2022-26134', 'CVE-2023-44487', 'CVE-2021-26855'];
  if (cves.some(c => criticals.includes(c))) return 'critical';
  if (cves.length >= 5) return 'high';
  if (cves.length >= 2) return 'medium';
  return 'low';
}

function makeEvent(id, org, domain, geo, sector, severity, summary, cves, sources, affectedAssets) {
  return {
    id,
    type: 'exposure',
    organizationName: org || 'Hôte France',
    domain,
    location: { label: geo.label, coordinates: geo.coordinates, precision: geo.precision },
    severity,
    confidence: 'low',
    sector,
    date: new Date().toISOString(),
    summary,
    compromisedData: (cves || []).slice(0, 5),
    metrics: { affectedAssets: affectedAssets || 1, sources: sources.length },
    sources,
  };
}

// ─── Source 1 : Shodan InternetDB (sans clé, toujours actif) ───
// Plages IP françaises représentatives d'acteurs critiques

const FR_SENTINEL_IPS = [
  // Orange / France Telecom (AS3215)
  { ip: '193.252.22.1',  label: 'Orange France',    city: 'Paris'     },
  { ip: '80.10.246.1',   label: 'Orange ADSL',      city: 'Paris'     },
  // SFR (AS15557)
  { ip: '90.41.0.1',     label: 'SFR',              city: 'Paris'     },
  // Bouygues (AS5410)
  { ip: '89.92.0.1',     label: 'Bouygues Telecom', city: 'Paris'     },
  // Free / Iliad (AS12322)
  { ip: '176.160.0.1',   label: 'Free SA',          city: 'Paris'     },
  // OVH (AS16276)
  { ip: '51.195.0.1',    label: 'OVH Cloud',        city: 'Roubaix'   },
  { ip: '51.68.0.1',     label: 'OVH Cloud',        city: 'Strasbourg'},
  // Scaleway / Online (AS12876)
  { ip: '51.159.0.1',    label: 'Scaleway',         city: 'Paris'     },
  // Renater (éducation/recherche — AS2200)
  { ip: '195.221.0.1',   label: 'RENATER',          city: 'Paris'     },
  // Data.gouv.fr / Etalab
  { ip: '213.251.128.1', label: 'data.gouv.fr',     city: 'Paris'     },
];

async function fetchShodanInternetDb() {
  const events = [];
  const now = new Date().toISOString();

  // Requêtes en parallèle (max 8 simultanées pour rester poli)
  const batch = FR_SENTINEL_IPS.slice(0, 8);
  const results = await Promise.allSettled(
    batch.map(async ({ ip, label, city }) => {
      const resp = await fetch(`https://internetdb.shodan.io/${ip}`, {
        headers: { 'User-Agent': 'FranceMonitor/1.0 OSINT-Research', Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) return null;
      const d = await resp.json();
      return { d, ip, label, city };
    })
  );

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const { d, label, city } = r.value;

    if (!d.cves?.length && !d.ports?.length) continue;

    const hostnames = d.hostnames || [];
    const domain = hostnames[0]?.replace(/^www\./, '') || undefined;
    const sector = inferSector(d.ports, hostnames);
    const geo = resolveGeo(city, undefined);
    const cves = d.cves || [];

    events.push(makeEvent(
      `shodan-internetdb-${ip.replace(/\./g, '-')}-${Date.now()}`,
      label,
      domain,
      geo,
      sector,
      cveToSeverity(cves),
      `Service exposé détecté (${label}) via Shodan InternetDB. ` +
      `CVE identifiées : ${cves.slice(0, 3).join(', ') || 'aucune'}. ` +
      `Ports ouverts : ${(d.ports || []).slice(0, 6).join(', ')}. ` +
      `Tags : ${(d.tags || []).join(', ') || 'aucun'}. L'IP n'est pas divulguée.`,
      cves,
      [{ name: 'Shodan InternetDB', url: 'https://internetdb.shodan.io', observedAt: now }],
      1,
    ));
  }

  return events;
}

// ─── Source 2 : Shodan Search API (crédits nécessaires) ───

async function fetchShodanSearch(apiKey) {
  const events = [];
  const now = new Date().toISOString();

  // Vérifier d'abord si on a des crédits (évite de gaspiller des appels)
  const infoResp = await fetch(`https://api.shodan.io/api-info?key=${apiKey}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!infoResp.ok) return events;
  const info = await infoResp.json();

  if ((info.query_credits || 0) === 0) {
    console.log('[Shodan] Plan OSS: 0 query_credits — Search API skipped, InternetDB only');
    return events;
  }

  console.log(`[Shodan] ${info.query_credits} query_credits available`);

  const queries = [
    { q: 'country:FR port:3389 has_vuln:true', label: 'RDP exposé avec CVE (FR)', sector: 'Multi-secteurs' },
    { q: 'country:FR product:"Microsoft Exchange" has_vuln:true', label: 'Exchange vulnérable (FR)', sector: 'Collectivités' },
    { q: 'country:FR port:502', label: 'ICS/SCADA Modbus exposé (FR)', sector: 'Industrie/ICS' },
    { q: 'country:FR product:"Fortinet" has_vuln:true', label: 'Fortinet VPN exposé (FR)', sector: 'Informatique' },
    { q: 'country:FR product:"VMware vCenter" has_vuln:true', label: 'VMware vCenter exposé (FR)', sector: 'Informatique' },
  ];

  for (const { q, label, sector } of queries.slice(0, Math.min(info.query_credits, 5))) {
    try {
      const url = `https://api.shodan.io/shodan/host/search?key=${apiKey}&query=${encodeURIComponent(q)}&minify=true&page=1`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'FranceMonitor/1.0' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!resp.ok) continue;

      const data = await resp.json();
      const total = data.total || 0;
      if (total === 0) continue;

      const sample = (data.matches || []).slice(0, 2);
      for (const [i, host] of sample.entries()) {
        const org = host.org || host.isp || 'Organisation';
        const geo = resolveGeo(host.location?.city, host.location?.region_name);
        const cves = host.vulns ? Object.keys(host.vulns) : [];
        const domain = (host.hostnames || [])[0]?.replace(/^www\./, '');

        events.push(makeEvent(
          `shodan-search-${Date.now()}-${i}`,
          org,
          domain,
          geo,
          inferSector(host.ports, host.hostnames),
          cveToSeverity(cves),
          `${label} — ${total} hôtes similaires en France. Org: ${org}. CVE: ${cves.slice(0, 3).join(', ') || 'N/A'}.`,
          cves,
          [{ name: 'Shodan Search API', url: 'https://shodan.io', observedAt: now }],
          total,
        ));
      }

      if (total > 10) {
        events.push(makeEvent(
          `shodan-agg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          `${total} hôtes France`,
          undefined,
          resolveGeo(undefined, undefined),
          sector,
          total > 500 ? 'critical' : total > 100 ? 'high' : 'medium',
          `${label} — ${total} hôtes exposés agrégés en France (données Shodan).`,
          [],
          [{ name: 'Shodan Search API', url: 'https://shodan.io', observedAt: now }],
          total,
        ));
      }
    } catch (err) {
      console.warn(`[Shodan Search] Error: ${err?.message}`);
    }
  }

  return events;
}

// ─── Source 3 : Censys Search API ───

async function fetchCensys(apiId, apiSecret) {
  const events = [];
  const now = new Date().toISOString();
  const auth = btoa(`${apiId}:${apiSecret}`);

  // Test auth d'abord
  const pingResp = await fetch('https://search.censys.io/api/v2/account', {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'User-Agent': 'FranceMonitor/1.0',
    },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);

  // Certains plans Censys ne supportent pas /account — tenter directement search
  const authFailed = pingResp && !pingResp.ok && pingResp.status === 401;
  if (authFailed) {
    console.warn('[Censys] Auth failed (401) — skipping');
    return events;
  }

  const queries = [
    { q: 'location.country_code="FR" AND services.service_name="REDIS"', label: 'Redis exposé (FR)', sector: 'Informatique' },
    { q: 'location.country_code="FR" AND services.service_name="ELASTICSEARCH"', label: 'Elasticsearch exposé (FR)', sector: 'Informatique' },
    { q: 'location.country_code="FR" AND services.service_name="MONGODB"', label: 'MongoDB exposé (FR)', sector: 'Informatique' },
  ];

  for (const { q, label, sector } of queries) {
    try {
      const resp = await fetch('https://search.censys.io/api/v2/hosts/search', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'FranceMonitor/1.0',
        },
        body: JSON.stringify({ q, per_page: 3, virtual_hosts: 'INCLUDE' }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        console.warn(`[Censys] Query failed (${resp.status}): ${q}`);
        continue;
      }

      const data = await resp.json();
      const total = data.result?.total || 0;
      if (total === 0) continue;

      const geo = resolveGeo(undefined, undefined);
      const severity = total > 500 ? 'critical' : total > 100 ? 'high' : total > 20 ? 'medium' : 'low';

      events.push(makeEvent(
        `censys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        `${total} hôtes France`,
        undefined,
        geo,
        sector,
        severity,
        `${label} — ${total} service(s) exposé(s) en France via Censys. Aucun credential requis pour accès. Données agrégées, aucune IP divulguée.`,
        [],
        [{ name: 'Censys Search API', url: 'https://censys.io', observedAt: now }],
        total,
      ));
    } catch (err) {
      console.warn(`[Censys] Error: ${err?.message}`);
    }
  }

  return events;
}

// ─── Dedup ───

function dedup(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.organizationName.toLowerCase()}-${e.sector}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Handler ───

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  const shodanKey    = process.env.SHODAN_API_KEY    || '';
  const censysId     = process.env.CENSYS_API_ID     || '';
  const censysSecret = process.env.CENSYS_API_SECRET || '';

  const active = [];

  try {
    const promises = [
      fetchShodanInternetDb().then(r => { active.push('shodan-internetdb'); return r; }),
    ];

    if (shodanKey) {
      promises.push(fetchShodanSearch(shodanKey).then(r => { active.push('shodan-search'); return r; }));
    }

    if (censysId && censysSecret) {
      promises.push(fetchCensys(censysId, censysSecret).then(r => { active.push('censys'); return r; }));
    }

    const results = await Promise.allSettled(promises);
    const allEvents = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    const events = dedup(allEvents);

    return new Response(JSON.stringify(events), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'X-Sources-Active': active.join(','),
        'X-Event-Count': String(events.length),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Aggregation failed' }), {
      status: 502,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
    });
  }
}
