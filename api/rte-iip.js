/**
 * api/rte-iip.js — Vercel Node.js Serverless Function
 *
 * Agrège les deux flux RSS IIP RTE (production + transmission) en un seul appel.
 * Utilise le runtime Node.js (pas Edge) pour contourner les restrictions réseau
 * des nœuds CDN Edge Vercel qui peuvent être bloqués par iip.cloud-rte-france.com.
 *
 * Route  : GET /api/rte-iip
 * Cache  : 10 min (s-maxage)
 * Output : { production: { items, sourceFormat }, transmission: { items, sourceFormat } }
 */

const IIP_FEEDS = [
  {
    url: 'https://iip.cloud-rte-france.com/data/rss/production_unavailability/production_unavailability.xml',
    type: 'production',
  },
  {
    url: 'https://iip.cloud-rte-france.com/data/rss/transmission_unavailability/transmission_unavailability.xml',
    type: 'transmission',
  },
];

const FETCH_TIMEOUT_MS = 22_000;
const CACHE_TTL_MS = 10 * 60_000;

const USER_AGENT =
  'FranceMonitor/2.0 (+https://francemonitor.com; situational-awareness-dashboard)';

// Module-level cache (shared across warm invocations)
let _cache = null;
let _cacheTime = 0;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(_cache);
  }

  try {
    const results = await Promise.allSettled(
      IIP_FEEDS.map(feed => fetchAndParse(feed.url, feed.type))
    );

    const data = {};
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const type = IIP_FEEDS[i].type;
      if (result.status === 'fulfilled') {
        const { type: _t, ...feedData } = result.value;
        data[type] = feedData;
      } else {
        console.error(`[rte-iip] ${type} feed failed:`, result.reason?.message);
        data[type] = { items: [], sourceFormat: 'error', error: result.reason?.message ?? 'unknown' };
      }
    }

    _cache = data;
    _cacheTime = now;

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[rte-iip] Fatal error:', err.message);
    if (_cache) {
      res.setHeader('Cache-Control', 's-maxage=60');
      return res.status(200).json(_cache);
    }
    return res.status(502).json({ error: err.message, production: null, transmission: null });
  }
}

async function fetchAndParse(url, type) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status} from IIP`);

    const xml = await resp.text();
    const sourceFormat = detectFormat(xml);
    const items = sourceFormat === 'xml' ? parseRssXml(xml) : [];

    return { type, items, sourceFormat };
  } finally {
    clearTimeout(timeout);
  }
}

function detectFormat(payload) {
  const sample = String(payload || '').slice(0, 400).toLowerCase();
  if (
    sample.includes('<!doctype html') ||
    sample.includes('<html') ||
    sample.includes('<body') ||
    sample.includes('<app-root')
  ) return 'html';
  if (sample.includes('<rss') || sample.includes('<feed') || sample.includes('<rdf:rdf')) return 'xml';
  return 'unknown';
}

function parseRssXml(xml) {
  const items = [];
  const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const itemXml = match[1];
    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link') || extractTag(itemXml, 'guid');
    const pubDate = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'dc:date');
    const description = extractTag(itemXml, 'description');
    if (title && link) {
      items.push({
        title: decodeEntities(title),
        link,
        pubDate: pubDate || new Date().toISOString(),
        isoDate: pubDate ? new Date(pubDate).toISOString() : undefined,
        description: description ? decodeEntities(description).slice(0, 1000) : undefined,
      });
    }
  }
  return items;
}

function extractTag(xml, tagName) {
  const cdataRe = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : null;
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, '');
}
