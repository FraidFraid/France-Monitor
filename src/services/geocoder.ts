/**
 * geocoder.ts — Géocodage via l'API Adresse du gouvernement français.
 * https://adresse.data.gouv.fr/api-doc/adresse
 * Gratuit, sans clé API, rate limit ~50 req/s.
 */

// ─── Cache ───

import { openDB, type IDBPDatabase } from 'idb';

interface GeoResult {
    lat: number;
    lon: number;
    locationName: string;
    confidence: number;
}

const geoCache = new Map<string, GeoResult | null>();
let dbPromise: Promise<IDBPDatabase | null> | null = null;

// Initialize IndexedDB lazily
function getDB() {
    if (!dbPromise) {
        // Must run in browser environment only
        if (typeof window === 'undefined' || !window.indexedDB) {
            dbPromise = Promise.resolve(null);
            return dbPromise;
        }

        dbPromise = openDB('francemonitor-geocache', 1, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('geo-results')) {
                    db.createObjectStore('geo-results');
                }
            }
        }).catch(err => {
            console.warn('[Geocoder] IndexedDB failed to init:', err);
            return null;
        });
    }
    return dbPromise;
}

// Load a specific key from IDB to Memory
async function loadFromDB(key: string): Promise<GeoResult | null | undefined> {
    try {
        const db = await getDB();
        if (!db) return undefined;
        return await db.get('geo-results', key);
    } catch {
        return undefined;
    }
}

// Save to both Memory and IDB
async function cacheResult(key: string, result: GeoResult | null): Promise<void> {
    geoCache.set(key, result);
    try {
        const db = await getDB();
        if (db) {
            await db.put('geo-results', result, key);
        }
    } catch (err) {
        console.warn('[Geocoder] Failed to save to IDB:', err);
    }
}

import { CITIES, REGIONS } from '../config/geo.ts';

// ─── Stop words ───

const STOP_WORDS = new Set([
    'france', 'europe', 'monde', 'selon', 'après', 'avant', 'pour',
    'dans', 'avec', 'sans', 'plus', 'moins', 'tout', 'tous',
    'très', 'aussi', 'encore', 'quand', 'comment', 'pourquoi',
    'président', 'ministre', 'gouvernement', 'assemblée', 'sénat',
    'ligue', 'championnat', 'coupe', 'jeux', 'olympique',
    'état', 'police', 'justice', 'guerre', 'loi', 'projet',
    'place', 'rue', 'avenue', 'boulevard', 'gare', 'nord', 'sud', 'est', 'ouest',
    'direct', 'vidéo', 'photo', 'image', 'alerte', 'urgence',
    'nouveau', 'nouvelle', 'grand', 'grande', 'premier', 'première',
    'procès', 'tribunal', 'appel', 'affaire', 'actu', 'info', 'actu',
]);

// ─── Location extraction from title ───

/**
 * Preposition-anchored pattern: "à Lyon", "de Paris", "en Bretagne", "dans le Rhône"
 */
const PREPOSITION_PATTERN =
    /(?:à|de|en|sur|près de|dans(?:\s+le|\s+la|\s+les|\s+l[''])?\s+)([A-ZÀ-Ü][a-zà-ü]+(?:[\s-][A-ZÀ-Ü][a-zà-ü]+)*)/g;

/** "Lyon : ...", "La Rochelle –" at start of title — only valid if word is a known city */
const TITLE_START_PATTERN =
    /^([A-ZÀ-Ü][a-zà-ü]+(?:[\s-][A-ZÀ-Ü][a-zà-ü]+)*)\s*[.–:-]/gm;

/** "..., Lyon, 240 salariés..." */
const COMMA_PATTERN =
    /,\s+([A-ZÀ-Ü][a-zà-ü]+(?:[\s-][A-ZÀ-Ü][a-zà-ü]+)*)\s*[,:]/g;

/** Normalized city name set for O(1) lookups */
let _normCitySet: Set<string> | null = null;
function normCitySet(): Set<string> {
    if (!_normCitySet) {
        _normCitySet = new Set(
            Object.keys(CITIES).map((c) =>
                c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            )
        );
    }
    return _normCitySet;
}

function isKnownCity(name: string): boolean {
    return normCitySet().has(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
}

/**
 * Extract potential location names from a news title.
 * Pass 1: preposition-anchored (very reliable)
 * Pass 2: "City :" title-start filtered to known cities (avoids "Tempête :", "Sida :")
 * Pass 3: city before comma
 * Pass 4: full-scan fallback against CITIES dictionary
 */
export function extractLocations(title: string): string[] {
    const locations: string[] = [];
    let match;

    // Pass 1 — prepositions
    PREPOSITION_PATTERN.lastIndex = 0;
    while ((match = PREPOSITION_PATTERN.exec(title)) !== null) {
        const loc = match[1].trim();
        if (loc.length >= 3 && !STOP_WORDS.has(loc.toLowerCase())) locations.push(loc);
    }

    // Pass 2 — title start "City :" (known cities only)
    TITLE_START_PATTERN.lastIndex = 0;
    while ((match = TITLE_START_PATTERN.exec(title)) !== null) {
        const loc = match[1].trim();
        if (loc.length >= 3 && !STOP_WORDS.has(loc.toLowerCase()) && isKnownCity(loc)) {
            locations.push(loc);
        }
    }

    // Pass 3 — ", City,"
    COMMA_PATTERN.lastIndex = 0;
    while ((match = COMMA_PATTERN.exec(title)) !== null) {
        const loc = match[1].trim();
        if (loc.length >= 3 && !STOP_WORDS.has(loc.toLowerCase())) locations.push(loc);
    }

    // Pass 4 — full-scan fallback against CITIES dictionary
    if (locations.length === 0) {
        // NFD sans accents, mais maintien de la casse pour éviter les faux positifs sur des mots communs ("eu" vs "Eu", "pau", "cannes")
        const normTitle = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        for (const cityName of Object.keys(CITIES)) {
            const normCity = cityName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // regex à frontières de mots (\b) sensible à la casse
            const wordBoundary = new RegExp(`\\b${normCity.replace(/-/g, '[\\s-]')}\\b`);
            if (wordBoundary.test(normTitle)) locations.push(cityName);
        }
    }

    return [...new Set(locations)];
}

/**
 * Geocode a location string using API Adresse Gouv.
 * Returns null if no result found.
 */
export async function geocode(query: string): Promise<GeoResult | null> {
    const cacheKey = query.toLowerCase().trim();

    // Check memory cache
    if (geoCache.has(cacheKey)) return geoCache.get(cacheKey) ?? null;

    // Check IndexedDB
    const idbCached = await loadFromDB(cacheKey);
    if (idbCached !== undefined) {
        geoCache.set(cacheKey, idbCached);
        return idbCached;
    }

    // Check known cities first
    const normCacheKey = cacheKey.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // Convert Config objects to a lookup format
    for (const [cityName, [lon, lat]] of Object.entries(CITIES)) {
        if (cityName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normCacheKey) {
            const result: GeoResult = { lat, lon, locationName: cityName, confidence: 1.0 };
            await cacheResult(cacheKey, result);
            return result;
        }
    }

    for (const region of Object.values(REGIONS)) {
        if (region.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normCacheKey) {
            const result: GeoResult = { lat: region.center[1], lon: region.center[0], locationName: region.name, confidence: 0.9 };
            await cacheResult(cacheKey, result);
            return result;
        }
    }

    try {
        // First try with type=municipality for exact city matches
        let url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1&type=municipality`;
        let resp = await fetch(url, { signal: AbortSignal.timeout(5000) });

        let data: {
            features: Array<{
                geometry: { coordinates: [number, number] };
                properties: { label: string; score: number; city?: string };
            }>;
        } | null = null;

        if (resp.ok) {
            data = await resp.json();
        }

        // If no municipality found, try without type filter (catches localities, hamlets, etc.)
        if (!data?.features?.length) {
            url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`;
            resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                data = await resp.json();
            }
        }

        if (!data?.features?.length) {
            await cacheResult(cacheKey, null);
            return null;
        }

        const feat = data.features[0];
        const [lon, lat] = feat.geometry.coordinates;
        const result: GeoResult = {
            lat,
            lon,
            locationName: feat.properties.city ?? feat.properties.label,
            confidence: feat.properties.score,
        };

        await cacheResult(cacheKey, result);
        return result;
    } catch {
        await cacheResult(cacheKey, null);
        return null;
    }
}

/**
 * Geocode a news item: extract locations from title, then try fallback region.
 * @param title - The news article title
 * @param feedRegion - Optional region name from the feed config (e.g. "Bretagne")
 */
export async function geocodeNewsItem(title: string, feedRegion?: string): Promise<GeoResult | null> {
    const locations = extractLocations(title);

    // Try each extracted location from the title
    for (const loc of locations) {
        const result = await geocode(loc);
        if (result && result.confidence > 0.4) {
            console.log(`[Geocoder] "${loc}" in "${title.slice(0, 60)}" ->`, result.locationName);
            return result;
        }
    }

    // Fallback: use the feed's region as a low-confidence location
    if (feedRegion) {
        const result = await geocode(feedRegion);
        if (result) {
            console.log(`[Geocoder] Fallback region "${feedRegion}" for "${title.slice(0, 60)}"`);
            return { ...result, confidence: 0.3 }; // low confidence = region centroid
        }
    }

    if (locations.length > 0) {
        console.log(`[Geocoder] No match for "${title.slice(0, 60)}", tried:`, locations);
    }
    return null;
}
