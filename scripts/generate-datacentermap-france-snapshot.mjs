import fs from 'node:fs/promises';
import path from 'node:path';

const COUNTRY_URL = 'https://www.datacentermap.com/france/';
const OUT_FILE = path.resolve('api/_shared/datacentermap-france-snapshot.js');
const USER_AGENT = 'Mozilla/5.0 (compatible; FranceMonitor/1.0; +https://www.datacentermap.com/france/)';
const DEFAULT_BUILD_ID = 'oaPXy8KvTcwm4r8BZw-Wl';
const FALLBACK_MARKETS = [
  'paris', 'grenoble', 'lyon', 'antibes', 'rennes', 'lille', 'nantes', 'rouen', 'tours', 'toulouse',
  'montpellier', 'dijon', 'bordeaux', 'strasbourg', 'nice', 'poitiers', 'avignon', 'auch', 'besancon',
  'bayonne', 'sophia-antipolis', 'valenciennes', 'marseille', 'annecy', 'metz', 'saint-gaudens',
  'le-creusot', 'le-mans', 'le-havre', 'la-rochelle', 'geneva-fr', 'angers', 'clermont-ferrand',
  'valence', 'reims', 'bourges', 'nancy', 'pau', 'limoges', 'roubaix', 'carcassonne', 'pringy',
  'arpajon', 'nimes', 'belfort', 'auxerre', 'saint-trivier-sur-moignans', 'laon', 'amiens',
  'angouleme', 'bastia', 'quimper', 'dax', 'saint-etienne', 'ajaccio', 'douai', 'roanne', 'toulon',
  'arras', 'cambrai', 'caen', 'alencon', 'calais', 'chartres', 'evreux', 'mareuil-sur-ay', 'narbonne', 'rodez',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new Error('Missing __NEXT_DATA__ payload');
  }
  return JSON.parse(match[1]);
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parsePowerDetail(text) {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(GW|GWh?|MWA?|MW)\b/i);
  if (!match) return '';
  return `${match[1].replace(',', '.')} ${match[2].toUpperCase()}`;
}

function toPowerBand(powerDetail) {
  const match = String(powerDetail).match(/(\d+(?:\.\d+)?)\s*(GW|GWH?|MWA?|MW)/i);
  if (!match) return '';
  const value = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const mw = unit.startsWith('G') ? value * 1000 : value;
  if (mw < 100) return 'moins de 100 MW';
  if (mw < 250) return 'entre 100 et 250 MW';
  if (mw <= 500) return 'entre 250 et 500 MW';
  return 'plus de 500 MW';
}

function toSnapshotRow(dc) {
  const properties = dc.properties ?? {};
  const coords = dc.geometry?.coordinates ?? [];
  const powerDetail = parsePowerDetail(properties.oneliner ?? '');
  return {
    id: `dcm-${properties.id}`,
    datacenterMapId: properties.id,
    name: normalizeWhitespace(properties.name),
    provider: normalizeWhitespace(properties.companyname),
    region: normalizeWhitespace(properties.city || properties.state || 'France'),
    city: normalizeWhitespace(properties.city),
    address: normalizeWhitespace([properties.address, properties.postal, properties.country].filter(Boolean).join(' ')),
    coordinates: [Number(coords[0]), Number(coords[1])],
    operationalState: 'site existant',
    powerBand: toPowerBand(powerDetail),
    powerDetail,
    detailSummary: normalizeWhitespace(properties.oneliner),
    listingType: normalizeWhitespace(properties.listingtype),
    capacityType: normalizeWhitespace(properties.capacitytype),
    sourceUrl: properties.url ? `https://www.datacentermap.com${properties.url}` : '',
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function fetchJsonWithRetry(url, attempts = 5) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function main() {
  let buildId = DEFAULT_BUILD_ID;
  let markets = [];

  try {
    const countryHtml = await fetchHtml(COUNTRY_URL);
    const countryData = parseNextData(countryHtml);
    buildId = countryData.buildId || DEFAULT_BUILD_ID;
    markets = countryData?.props?.pageProps?.mapdata?.geos ?? [];
  } catch {
    try {
      const countryData = await fetchJsonWithRetry(`https://www.datacentermap.com/_next/data/${DEFAULT_BUILD_ID}/datacenters/geos.json?target=country&country=france&rw=true`, 2);
      markets = countryData?.pageProps?.mapdata?.geos ?? [];
    } catch {
      markets = FALLBACK_MARKETS.map((link) => ({ properties: { link } }));
    }
  }
  const byId = new Map();
  const orderedMarkets = [...markets].sort((left, right) => {
    const a = left?.properties?.link === 'paris' ? 1 : 0;
    const b = right?.properties?.link === 'paris' ? 1 : 0;
    return a - b;
  });

  for (const market of orderedMarkets) {
    const marketLink = market?.properties?.link;
    if (!marketLink) continue;
    const marketUrl = `https://www.datacentermap.com/_next/data/${buildId}/datacenters/dcs.json?country=france&market=${encodeURIComponent(marketLink)}&rw=true`;
    let marketData;
    try {
      marketData = await fetchJsonWithRetry(marketUrl, marketLink === 'paris' ? 6 : 4);
    } catch (error) {
      console.warn(`Skipping market ${marketLink}: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(marketLink === 'paris' ? 5000 : 1000);
      continue;
    }
    const dcs = marketData?.pageProps?.mapdata?.dcs ?? [];
    for (const dc of dcs) {
      const row = toSnapshotRow(dc);
      if (!Number.isFinite(row.coordinates[0]) || !Number.isFinite(row.coordinates[1])) continue;
      const existing = byId.get(row.id);
      if (!existing) {
        byId.set(row.id, row);
        continue;
      }
      if (!existing.powerDetail && row.powerDetail) existing.powerDetail = row.powerDetail;
      if (!existing.powerBand && row.powerBand) existing.powerBand = row.powerBand;
      if (!existing.detailSummary && row.detailSummary) existing.detailSummary = row.detailSummary;
      if (!existing.sourceUrl && row.sourceUrl) existing.sourceUrl = row.sourceUrl;
    }
    await sleep(marketLink === 'paris' ? 1000 : 350);
  }

  const rows = [...byId.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.city.localeCompare(b.city),
  );

  const output = `export const DATACENTERMAP_FRANCE_SNAPSHOT = ${JSON.stringify(rows, null, 2)};\n`;
  await fs.writeFile(OUT_FILE, output, 'utf8');
  console.log(`Wrote ${rows.length} facilities to ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
