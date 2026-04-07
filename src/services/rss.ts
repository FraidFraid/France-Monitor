/**
 * rss.ts — Service RSS frontend.
 * Fetch les flux via le proxy, parse le XML, retourne des NewsItem[].
 * Circuit breaker par flux (cooldown 5min après 2 échecs).
 * Cache en mémoire (TTL 10min).
 * Fallback Scrapling : pour certains flux Cloudflare, activable explicitement
 * via `VITE_USE_LOCAL_RSS_PROXY=true`.
 */

import type { NewsItem, Feed } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

// ── Watchdog registration ──
Watchdog.register('rss-pqr', {
    label: 'RSS PQR',
    staleAfterMs: 10 * 60_000,
    detail: 'Flux RSS PQR via proxy /api/rss-proxy + Scrapling (Cloudflare)',
});

// ─── Scrapling Proxy (Cloudflare bypass) ───

const SCRAPLING_PROXY_URL = (import.meta.env.VITE_SCRAPLING_PROXY_URL as string) || '';
const USE_LOCAL_RSS_PROXY = import.meta.env.VITE_USE_LOCAL_RSS_PROXY === 'true';

const SCRAPLING_DOMAINS = new Set([
    'services.lesechos.fr',
    'www.lesechos.fr',
    'www.lavoixdunord.fr',
    'www.paris-normandie.fr',
]);

function needsScrapling(feedUrl: string): boolean {
    if (!USE_LOCAL_RSS_PROXY || !SCRAPLING_PROXY_URL) return false;
    try {
        const url = new URL(feedUrl);
        return SCRAPLING_DOMAINS.has(url.hostname);
    } catch {
        return false;
    }
}

async function fetchViaScrapling(feedUrl: string): Promise<string> {
    const proxyUrl = `${SCRAPLING_PROXY_URL}/rss?url=${encodeURIComponent(feedUrl)}`;
    const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
        throw new Error(`Scrapling proxy returned ${resp.status}`);
    }
    return resp.text();
}

// ─── Circuit Breaker (par flux) ───

interface CBState {
    failures: number;
    cooldownUntil: number;
}

const breakers = new Map<string, CBState>();
const CB_MAX_FAILURES = 2;
const CB_COOLDOWN_MS = 5 * 60_000; // 5 min

function isOpen(feedUrl: string): boolean {
    const cb = breakers.get(feedUrl);
    if (!cb || cb.failures < CB_MAX_FAILURES) return false;
    if (Date.now() > cb.cooldownUntil) {
        // Half-open: reset
        breakers.delete(feedUrl);
        return false;
    }
    return true;
}

function recordFailure(feedUrl: string): void {
    const cb = breakers.get(feedUrl) ?? { failures: 0, cooldownUntil: 0 };
    cb.failures++;
    cb.cooldownUntil = Date.now() + CB_COOLDOWN_MS;
    breakers.set(feedUrl, cb);
}

function recordSuccess(feedUrl: string): void {
    breakers.delete(feedUrl);
}

// ─── In-memory cache ───

interface CacheEntry {
    items: NewsItem[];
    fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60_000; // 10 min

// ─── Dedup by URL ───

const seenUrls = new Set<string>();

// ─── Timezone Handling ───

function parseRSSDate(pubDateStr: string, feedRegion?: string): Date {
    const rawDate = new Date(pubDateStr);
    if (isNaN(rawDate.getTime())) return new Date();

    // If string has an explicit timezone (like +0400, -03:00, Z, GMT), JS parsed it correctly
    if (/(?:GMT|UTC|Z|[+-]\d{2}:?\d{2})/i.test(pubDateStr)) {
        return rawDate;
    }

    // Otherwise, treat literal time components as if they were in the region's UTC offset
    let offsetUTC = 0;
    let applies = false;

    switch (feedRegion) {
        case 'La Réunion': offsetUTC = 4; applies = true; break;
        case 'Mayotte': offsetUTC = 3; applies = true; break;
        case 'Guyane': offsetUTC = -3; applies = true; break;
        case 'Martinique':
        case 'Guadeloupe': offsetUTC = -4; applies = true; break;
        case 'Nouvelle-Calédonie': offsetUTC = 11; applies = true; break;
        case 'Polynésie': offsetUTC = -10; applies = true; break;
    }

    if (applies) {
        const y = rawDate.getFullYear();
        const m = rawDate.getMonth();
        const d = rawDate.getDate();
        const h = rawDate.getHours();
        const min = rawDate.getMinutes();
        const s = rawDate.getSeconds();
        return new Date(Date.UTC(y, m, d, h - offsetUTC, min, s));
    }

    return rawDate;
}

// ─── XML Parsing ───

function parseRSSItems(xml: string, feed: Feed): NewsItem[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) return [];

    const items: NewsItem[] = [];
    const entries = doc.querySelectorAll('item, entry'); // RSS vs Atom

    for (const entry of entries) {
        const title = entry.querySelector('title')?.textContent?.trim() ?? '';
        const link =
            entry.querySelector('link')?.textContent?.trim() ??
            entry.querySelector('link')?.getAttribute('href') ??
            '';

        if (!title || !link) continue;
        if (seenUrls.has(link)) continue;
        seenUrls.add(link);

        const pubDateStr =
            entry.querySelector('pubDate')?.textContent ??
            entry.querySelector('published')?.textContent ??
            entry.querySelector('updated')?.textContent ??
            '';
        const pubDate = pubDateStr ? parseRSSDate(pubDateStr, feed.region) : new Date();
        if (isNaN(pubDate.getTime())) continue;

        const description =
            entry.querySelector('description')?.textContent?.trim() ??
            entry.querySelector('summary')?.textContent?.trim() ??
            '';

        const id = `rss-${hashString(link)}`;

        items.push({
            id,
            source: feed.name,
            title,
            link,
            pubDate,
            isAlert: false,
            tier: feed.tier,
            feedRegion: feed.region, // propagate region for geocoding fallback
            summary: description.slice(0, 200) || undefined,
            // threat, lat, lon, locationName will be filled by classifier + geocoder
        });
    }

    return items;
}

/** Simple hash for dedup IDs */
function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
}

// ─── Public API ───

/**
 * Fetch un flux RSS via le proxy et retourne les items parsés.
 * Uses circuit breaker and in-memory cache.
 */
export async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
    // Check circuit breaker
    if (isOpen(feed.url)) {
        console.warn(`[RSS] Circuit breaker OPEN for ${feed.name}`);
        Watchdog.report('rss-pqr', { type: 'failure', error: 'circuit breaker ouvert', isFallback: true });
        return cache.get(feed.url)?.items ?? [];
    }

    // Check cache
    const cached = cache.get(feed.url);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.items;
    }

    Watchdog.report('rss-pqr', { type: 'loading' });
    const t0 = Date.now();

    try {
        let xml: string;

        if (needsScrapling(feed.url)) {
            console.log(`[RSS] ${feed.name}: using Scrapling proxy`);
            Watchdog.report('rss-pqr', { type: 'fallback', reason: 'Scrapling (Cloudflare bypass)' });
            xml = await fetchViaScrapling(feed.url);
        } else {
            const proxyUrl = `/api/rss-proxy?url=${encodeURIComponent(feed.url)}`;
            const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10_000) });

            if (!resp.ok) {
                recordFailure(feed.url);
                console.warn(`[RSS] ${feed.name} returned ${resp.status}`);
                Watchdog.report('rss-pqr', { type: 'failure', error: `HTTP ${resp.status}`, isFallback: !!cached });
                return cached?.items ?? [];
            }

            xml = await resp.text();
        }

        const items = parseRSSItems(xml, feed);

        recordSuccess(feed.url);
        cache.set(feed.url, { items, fetchedAt: Date.now() });
        Watchdog.report('rss-pqr', { type: 'success', responseTimeMs: Date.now() - t0 });

        console.log(`[RSS] ${feed.name}: ${items.length} items`);
        return items;
    } catch (err) {
        recordFailure(feed.url);
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[RSS] ${feed.name} fetch failed:`, err);
        Watchdog.report('rss-pqr', { type: 'failure', error: msg, isFallback: !!cached });
        return cached?.items ?? [];
    }
}

/**
 * Fetch all feeds in parallel, return merged + deduped items sorted by date.
 */
export async function fetchAllFeeds(feeds: Feed[]): Promise<NewsItem[]> {
    const results = await Promise.allSettled(feeds.map(fetchFeed));
    const allItems: NewsItem[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            allItems.push(...result.value);
        }
    }
    // Sort by pubDate desc
    allItems.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    return allItems;
}

/** Clear all caches (useful for testing) */
export function clearRSSCache(): void {
    cache.clear();
    seenUrls.clear();
    breakers.clear();
}
