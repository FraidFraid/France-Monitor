/**
 * newsCache.ts — Cache localStorage pour les articles RSS.
 * Affiche instantanément les articles au rechargement de page
 * pendant que le pipeline RSS rafraîchit les données en arrière-plan.
 */

import type { NewsItem } from '../types/index.ts';

const CACHE_KEY = 'fm_news_cache_v2';
const LEGACY_CACHE_KEYS = ['fm_news_cache'];
const CACHE_MAX_AGE = 60 * 60_000; // 1 heure max

interface CachedNews {
    items: Array<{
        id: string;
        title: string;
        link: string;
        source: string;
        pubDate: string; // ISO string
        summary?: string;
        lat?: number;
        lon?: number;
        locationName?: string;
        isAlert?: boolean;
        tier?: number;
        threat?: NewsItem['threat'];
    }>;
    savedAt: number;
}

/**
 * Sauvegarde les articles dans localStorage.
 */
export function saveNewsToCache(items: NewsItem[]): void {
    try {
        const cached: CachedNews = {
            items: items.map((it) => ({
                id: it.id,
                title: it.title,
                link: it.link,
                source: it.source,
                pubDate: it.pubDate.toISOString(),
                summary: it.summary,
                lat: it.lat,
                lon: it.lon,
                locationName: it.locationName,
                isAlert: it.isAlert,
                tier: it.tier,
                threat: it.threat,
            })),
            savedAt: Date.now(),
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
        console.log(`[Cache] Saved ${items.length} items to localStorage`);
    } catch {
        // localStorage plein ou désactivé — on ignore
    }
}

/**
 * Charge les articles depuis localStorage.
 * Retourne null si le cache est vide ou trop vieux.
 */
export function loadNewsFromCache(): NewsItem[] | null {
    try {
        for (const legacyKey of LEGACY_CACHE_KEYS) {
            localStorage.removeItem(legacyKey);
        }

        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;

        const cached: CachedNews = JSON.parse(raw);

        // Trop vieux → ignorer
        if (Date.now() - cached.savedAt > CACHE_MAX_AGE) {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }

        // Reconvertir les dates ISO en objets Date
        const items: NewsItem[] = cached.items.map((it) => ({
            ...it,
            isAlert: it.isAlert ?? false,
            pubDate: new Date(it.pubDate),
        }));

        console.log(`[Cache] Loaded ${items.length} items from localStorage (age: ${Math.round((Date.now() - cached.savedAt) / 60_000)}min)`);
        return items;
    } catch {
        return null;
    }
}
