/**
 * rss.ts — Service RSS frontend.
 * Chemin principal : /api/rss (JSON pré-parsé côté serveur) → AUCUN parsing XML
 * sur le main thread. Fallback : /api/rss-proxy (XML brut) + DOMParser, conservé
 * pour la robustesse (transition, parser serveur en échec, flux exotiques).
 * Circuit breaker par flux (cooldown avec backoff exponentiel après 2 échecs).
 * Cache en mémoire (TTL 10min).
 * Fallback Scrapling : pour certains flux Cloudflare, activable explicitement
 * via `VITE_USE_LOCAL_RSS_PROXY=true`.
 */

import type { NewsItem, Feed, ThreatClassification, ThreatLevel, EventCategory } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

// ── Watchdog registration ──
Watchdog.register('rss-pqr', {
    label: 'RSS PQR',
    staleAfterMs: 10 * 60_000,
    detail: 'Flux RSS PQR via /api/rss (JSON serveur) + fallback /api/rss-proxy + Scrapling (Cloudflare)',
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
    /** Nombre d'ouvertures successives du breaker (pilote le backoff exponentiel) */
    openCount: number;
    /** true = cooldown expiré, une tentative unique est en cours (half-open) */
    halfOpen: boolean;
}

const breakers = new Map<string, CBState>();
const CB_MAX_FAILURES = 2;
// Backoff exponentiel : 2 min → 5 min → 10 min (plafond)
const CB_BACKOFF_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000];

function backoffFor(openCount: number): number {
    const idx = Math.min(Math.max(openCount - 1, 0), CB_BACKOFF_MS.length - 1);
    return CB_BACKOFF_MS[idx];
}

function isOpen(feedUrl: string): boolean {
    const cb = breakers.get(feedUrl);
    if (!cb || cb.failures < CB_MAX_FAILURES) return false;
    if (cb.halfOpen) return false; // tentative half-open déjà autorisée
    if (Date.now() > cb.cooldownUntil) {
        // Half-open : autoriser UNE tentative. Succès → reset, échec → réouverture avec backoff supérieur.
        cb.halfOpen = true;
        return false;
    }
    return true;
}

function recordFailure(feedUrl: string): void {
    const cb = breakers.get(feedUrl) ?? { failures: 0, cooldownUntil: 0, openCount: 0, halfOpen: false };
    cb.failures++;
    if (cb.failures >= CB_MAX_FAILURES) {
        // Ouverture (ou réouverture après échec en half-open) → backoff exponentiel
        cb.openCount++;
        cb.cooldownUntil = Date.now() + backoffFor(cb.openCount);
    }
    cb.halfOpen = false;
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

interface JsonProxyItem {
    title?: string;
    link?: string;
    pubDate?: string;
    description?: string;
}

interface JsonProxyResponse {
    items?: JsonProxyItem[];
    sourceFormat?: 'xml' | 'html' | 'unknown';
    error?: string;
    message?: string;
}

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

/**
 * Returns null if the XML is actually an HTML page (bot-detection / redirect).
 * Returning null lets fetchFeed treat this as a failure and avoid caching empty results.
 */
function parseRSSItems(xml: string, feed: Feed): NewsItem[] | null {
    // Detect HTML responses (Cloudflare challenge, paywall redirect, etc.)
    const head = xml.trimStart().slice(0, 300).toLowerCase();
    if (
        head.startsWith('<!doctype html') ||
        head.startsWith('<html') ||
        head.includes('<body') ||
        head.includes('<app-root')
    ) {
        console.warn(`[RSS] ${feed.name}: received HTML instead of XML — likely bot-detection`);
        return null;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        console.warn(`[RSS] ${feed.name}: XML parse error`);
        return null;
    }

    const items: NewsItem[] = [];
    const entries = doc.querySelectorAll('item, entry'); // RSS vs Atom

    for (const entry of entries) {
        const title = entry.querySelector('title')?.textContent?.trim() ?? '';
        // Use || (not ??) so empty string falls through to getAttribute('href').
        // Atom feeds use <link href="..."/> (no text content) — ?? would keep "" and skip all items.
        const link =
            entry.querySelector('link')?.textContent?.trim() ||
            entry.querySelector('link')?.getAttribute('href') ||
            '';

        if (!title || !link) continue;
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

async function fetchViaJsonProxy(feed: Feed): Promise<{ items: NewsItem[]; sourceFormat: 'xml' | 'html' | 'unknown' }> {
    const proxyUrl = `/api/rss?url=${encodeURIComponent(feed.url)}`;
    const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
        throw new Error(`JSON RSS proxy returned ${resp.status}`);
    }

    const payload = await resp.json() as JsonProxyResponse;
    const sourceFormat = payload.sourceFormat ?? 'unknown';
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items: NewsItem[] = [];

    for (const rawItem of rawItems) {
        const title = typeof rawItem.title === 'string' ? rawItem.title.trim() : '';
        const link = typeof rawItem.link === 'string' ? rawItem.link.trim() : '';
        if (!title || !link) continue;

        const rawDate = typeof rawItem.pubDate === 'string' ? rawItem.pubDate : '';
        const pubDate = rawDate ? parseRSSDate(rawDate, feed.region) : new Date();
        if (isNaN(pubDate.getTime())) continue;

        const id = `rss-${hashString(link)}`;
        items.push({
            id,
            source: feed.name,
            title,
            link,
            pubDate,
            isAlert: false,
            tier: feed.tier,
            feedRegion: feed.region,
            summary: rawItem.description?.slice(0, 200) || undefined,
        });
    }

    return { items, sourceFormat };
}

// ─── Ingestion API consolidée (/api/news) ───

interface IngestApiItem {
    id?: number;
    feedId?: string;
    feedName?: string | null;
    feedRegion?: string | null;
    tier?: number | null;
    title?: string;
    link?: string;
    description?: string | null;
    publishedAt?: string | null;
    collectedAt?: string;
    category?: string | null;
    severity?: string | null;
    confidence?: number | null;
    lat?: number | null;
    lon?: number | null;
    // Champs additifs du scoring serveur (api/_handlers/news.js, cf. audit §4.5) —
    // absents tant que l'item n'a pas été scoré par Jev.
    relevance?: number | null;
    noise?: boolean | null;
    alertable?: boolean | null;
    scope?: string | null;
    scoredBy?: 'keywords' | 'groq' | 'jev' | null;
}

interface IngestApiResponse {
    items?: IngestApiItem[];
    count?: number;
    generatedAt?: string;
}

const THREAT_LEVELS: ReadonlySet<string> = new Set<ThreatLevel>(['critical', 'high', 'medium', 'low', 'info']);
const EVENT_CATEGORIES: ReadonlySet<string> = new Set<EventCategory>([
    'social', 'security', 'energy', 'weather', 'transport', 'infrastructure',
    'health', 'general', 'finance', 'floods', 'fires', 'cyber',
]);

function isThreatLevel(value: string): value is ThreatLevel {
    return THREAT_LEVELS.has(value);
}

function isEventCategory(value: string): value is EventCategory {
    return EVENT_CATEGORIES.has(value);
}

const SCORED_BY_VALUES: ReadonlySet<string> = new Set(['keywords', 'groq', 'jev']);

function isScoredBy(value: unknown): value is 'keywords' | 'groq' | 'jev' {
    return typeof value === 'string' && SCORED_BY_VALUES.has(value);
}

/**
 * Construit la classification d'un item serveur déjà classifié.
 * Retourne undefined si category/severity manquants ou hors vocabulaire
 * (→ App.ts re-classifiera via le pipeline keyword habituel).
 *
 * `source` reflète le moteur réel (`scoredBy`, dérivé serveur de
 * `classifier_version`) : 'llm' pour Groq/Jev, 'keyword' sinon — avant ce
 * changement, tout item serveur ressortait toujours en 'keyword' même
 * classifié par Groq (cf. audit §4.5 / annexe C §1).
 */
function buildServerClassification(item: IngestApiItem): ThreatClassification | undefined {
    const category = typeof item.category === 'string' ? item.category : '';
    const severity = typeof item.severity === 'string' ? item.severity : '';
    if (!isEventCategory(category) || !isThreatLevel(severity)) return undefined;
    const source: ThreatClassification['source'] =
        item.scoredBy === 'groq' || item.scoredBy === 'jev' ? 'llm' : 'keyword';
    return {
        level: severity,
        category,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
        source,
    };
}

function mapIngestItem(raw: IngestApiItem): NewsItem | null {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const link = typeof raw.link === 'string' ? raw.link.trim() : '';
    if (!title || !link) return null;

    const dateStr = raw.publishedAt ?? raw.collectedAt ?? '';
    const pubDate = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(pubDate.getTime())) return null;

    const hasCoords = typeof raw.lat === 'number' && typeof raw.lon === 'number';

    return {
        id: `rss-${hashString(link)}`,
        source: raw.feedName ?? raw.feedId ?? 'Ingest',
        title,
        link,
        pubDate,
        isAlert: false,
        tier: typeof raw.tier === 'number' ? raw.tier : undefined,
        feedRegion: raw.feedRegion ?? undefined,
        summary: typeof raw.description === 'string' ? raw.description.slice(0, 200) || undefined : undefined,
        threat: buildServerClassification(raw),
        lat: hasCoords && typeof raw.lat === 'number' ? raw.lat : undefined,
        lon: hasCoords && typeof raw.lon === 'number' ? raw.lon : undefined,
        relevance: typeof raw.relevance === 'number' ? raw.relevance : undefined,
        noise: typeof raw.noise === 'boolean' ? raw.noise : undefined,
        alertable: typeof raw.alertable === 'boolean' ? raw.alertable : undefined,
        scope: typeof raw.scope === 'string' ? raw.scope : undefined,
        scoredBy: isScoredBy(raw.scoredBy) ? raw.scoredBy : undefined,
    };
}

// ─── Mémoïsation de /api/news ───
// Arrondir `since` à un palier de 5 min rend l'URL stable pour tous les
// visiteurs dans cette fenêtre → le CDN Vercel peut enfin servir un HIT
// (avant ce correctif, la précision milliseconde rendait chaque URL unique :
// 4,7 s mesurés en prod à chaque visite, cf. audit C6/P0).
// La mémoïsation en mémoire (promesse en vol + résultat 60 s) évite en plus
// un doublon de requête quand un préchargement précoce (App.ts, avant
// l'init de la carte) et le pipeline normal (fetchAllFeeds) appellent tous
// les deux fetchFromIngestApi() à quelques centaines de ms d'écart.
const INGEST_SINCE_BUCKET_MS = 5 * 60_000;
const INGEST_MEMO_TTL_MS = 60_000;

let ingestInFlight: Promise<NewsItem[] | null> | null = null;
let ingestMemo: { items: NewsItem[] | null; fetchedAt: number } | null = null;

function floorToBucket(ms: number, bucketMs: number): number {
    return Math.floor(ms / bucketMs) * bucketMs;
}

/**
 * Tente le chemin consolidé /api/news (items déjà classifiés + géocodés serveur).
 * Retourne null (sans jeter) si l'API est indisponible (503, 404 dev sans plugin,
 * timeout, payload invalide ou vide) → fallback vers le fetch direct des flux.
 *
 * Mémoïsé 60 s (résultat + promesse en vol partagée) : plusieurs appels
 * rapprochés ne déclenchent qu'une seule requête réseau. Signature et nom
 * inchangés — les appelants existants n'ont rien à modifier.
 */
export async function fetchFromIngestApi(): Promise<NewsItem[] | null> {
    const now = Date.now();
    if (ingestMemo && now - ingestMemo.fetchedAt < INGEST_MEMO_TTL_MS) {
        return ingestMemo.items;
    }
    if (ingestInFlight) {
        return ingestInFlight;
    }

    const run = (async (): Promise<NewsItem[] | null> => {
        try {
            const sinceMs = floorToBucket(now - 24 * 60 * 60_000, INGEST_SINCE_BUCKET_MS);
            const since = new Date(sinceMs).toISOString();
            const url = `/api/news?since=${encodeURIComponent(since)}&limit=1000`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
            if (resp.status !== 200) return null;

            const payload = await resp.json() as IngestApiResponse;
            if (!Array.isArray(payload.items) || payload.items.length === 0) return null;

            const items: NewsItem[] = [];
            for (const raw of payload.items) {
                const item = mapIngestItem(raw);
                if (item) items.push(item);
            }
            return items.length > 0 ? items : null;
        } catch {
            return null;
        }
    })();

    ingestInFlight = run;
    try {
        const result = await run;
        ingestMemo = { items: result, fetchedAt: Date.now() };
        return result;
    } finally {
        ingestInFlight = null;
    }
}

// ─── Public API ───

/**
 * Fetch les items d'un flux SANS parsing XML sur le main thread.
 *
 * Ordre :
 * 1. /api/rss (JSON pré-parsé côté serverless) — chemin principal.
 * 2. /api/rss-proxy (XML brut) + DOMParser — fallback de robustesse si le
 *    parser serveur échoue ou renvoie 0 items sur un flux pourtant XML.
 *
 * Retourne null si les deux chemins échouent (→ circuit breaker).
 */
async function fetchItemsOffMainThread(feed: Feed, cachedExists: boolean): Promise<NewsItem[] | null> {
    let jsonError: string | null;

    // ── 1. Chemin principal : JSON pré-parsé côté serveur ──
    try {
        const json = await fetchViaJsonProxy(feed);
        if (json.items.length > 0) {
            return json.items;
        }
        if (json.sourceFormat === 'html') {
            // Réponse HTML (bot-detection / paywall) — le DOMParser n'y arrivera pas mieux.
            Watchdog.report('rss-pqr', { type: 'failure', error: 'HTML response (bot-detection?)', isFallback: cachedExists });
            return null;
        }
        // 0 items mais XML/unknown : le parser regex serveur a pu rater un format
        // exotique — laisser le fallback DOMParser tenter sa chance.
        jsonError = 'JSON proxy returned 0 items';
    } catch (err) {
        jsonError = err instanceof Error ? err.message : String(err);
    }

    // ── 2. Fallback : XML brut + DOMParser (main thread, rare) ──
    try {
        const proxyUrl = `/api/rss-proxy?url=${encodeURIComponent(feed.url)}`;
        const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) {
            console.warn(`[RSS] ${feed.name} returned ${resp.status} (after JSON path: ${jsonError})`);
            Watchdog.report('rss-pqr', { type: 'failure', error: `HTTP ${resp.status}`, isFallback: cachedExists });
            return null;
        }

        const xml = await resp.text();
        const items = parseRSSItems(xml, feed);
        if (items === null) {
            Watchdog.report('rss-pqr', { type: 'failure', error: 'XML parse failure', isFallback: cachedExists });
            return null;
        }
        if (items.length > 0) {
            console.warn(`[RSS] ${feed.name}: recovered ${items.length} items via DOMParser fallback`);
        }
        // Flux XML valide mais vide des deux côtés : succès avec 0 items.
        return items;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Watchdog.report('rss-pqr', { type: 'failure', error: msg, isFallback: cachedExists });
        return null;
    }
}

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
        let items: NewsItem[] | null;

        if (needsScrapling(feed.url)) {
            // Scrapling (dev opt-in, Cloudflare bypass) renvoie du XML brut :
            // le DOMParser main-thread reste nécessaire sur ce chemin marginal.
            console.log(`[RSS] ${feed.name}: using Scrapling proxy`);
            Watchdog.report('rss-pqr', { type: 'fallback', reason: 'Scrapling (Cloudflare bypass)' });
            const xml = await fetchViaScrapling(feed.url);
            items = parseRSSItems(xml, feed);
            if (items === null) {
                Watchdog.report('rss-pqr', { type: 'failure', error: 'XML parse failure (Scrapling)', isFallback: !!cached });
            }
        } else {
            items = await fetchItemsOffMainThread(feed, !!cached);
        }

        if (items === null) {
            recordFailure(feed.url);
            return cached?.items ?? [];
        }

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

// ─── Concurrency pool ───

const MAX_CONCURRENT_FEEDS = 8;

/**
 * Exécute des tâches async avec une limite de concurrence.
 * Équivalent de Promise.allSettled(tasks.map((t) => t())) mais max `limit` simultanées.
 */
async function runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    limit: number,
): Promise<PromiseSettledResult<T>[]> {
    const results = new Array<PromiseSettledResult<T>>(tasks.length);
    let nextIndex = 0;

    async function workerLoop(): Promise<void> {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            try {
                results[index] = { status: 'fulfilled', value: await tasks[index]() };
            } catch (err) {
                results[index] = { status: 'rejected', reason: err };
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(limit, tasks.length) },
        () => workerLoop(),
    );
    await Promise.all(workers);
    return results;
}

/**
 * Fetch all feeds (max 8 en parallèle), return merged + deduped items sorted by date.
 */
export async function fetchAllFeeds(feeds: Feed[]): Promise<NewsItem[]> {
    // ── Chemin principal : API d'ingestion consolidée (items classifiés + géocodés serveur) ──
    const ingestT0 = Date.now();
    const ingestItems = await fetchFromIngestApi();
    if (ingestItems !== null) {
        console.info('[rss] source: ingest-api');
        const deduped: NewsItem[] = [];
        const seen = new Set<string>();
        for (const item of ingestItems) {
            if (seen.has(item.link)) continue;
            seen.add(item.link);
            deduped.push(item);
        }
        deduped.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
        Watchdog.report('rss-pqr', { type: 'success', responseTimeMs: Date.now() - ingestT0 });
        return deduped;
    }

    // ── Mode dégradé : fetch direct des flux individuels (comportement historique) ──
    console.info('[rss] source: direct-feeds');
    const results = await runWithConcurrency(
        feeds.map((feed) => () => fetchFeed(feed)),
        MAX_CONCURRENT_FEEDS,
    );
    const allItems: NewsItem[] = [];
    const seenUrls = new Set<string>();
    for (const result of results) {
        if (result.status === 'fulfilled') {
            for (const item of result.value) {
                if (seenUrls.has(item.link)) continue;
                seenUrls.add(item.link);
                allItems.push(item);
            }
        }
    }
    // Sort by pubDate desc
    allItems.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    return allItems;
}

/** Clear all caches (useful for testing) */
export function clearRSSCache(): void {
    cache.clear();
    breakers.clear();
    ingestMemo = null;
    ingestInFlight = null;
}
