/**
 * exposure.ts — Service d'exposition technique passive (OSINT)
 *
 * Agrège des sources d'exposition publique pour cartographier les services
 * français vulnérables ou mal configurés sans interaction directe avec les cibles.
 *
 * Sources (Phase 4) :
 *   - Shodan (InternetDB — API publique, sans clé)
 *   - NIST NVD — CVE liées aux produits exposés
 *
 * Sources (Phase 5 — API keys nécessaires) :
 *   - Shodan Search API (SHODAN_API_KEY)
 *   - Censys Search API (CENSYS_API_ID + CENSYS_API_SECRET)
 *
 * Éthique & Conformité RGPD :
 *   ❌ Aucune IP précise exposée côté client
 *   ❌ Aucune donnée permettant d'identifier un individu
 *   ✅ Données agrégées par secteur/région uniquement
 *   ✅ Sources 100% publiques et légales (OSINT)
 *   ✅ Niveau de confiance "low" par défaut (données estimées)
 *   ✅ Timestamp de collecte systématique
 *
 * Architecture : Vercel Edge Function /api/exposure → ThreatEvent[]
 */

import type { ThreatEvent } from '../types/index.ts';

// ═══ Cache ═══

interface ExposureCache {
  events: ThreatEvent[];
  fetchedAt: number;
}

let cache: ExposureCache | null = null;
const CACHE_TTL = 30 * 60_000; // 30 minutes (données moins volatiles)

// ═══ API URLs ═══

const EXPOSURE_API_URL = import.meta.env.PROD
  ? '/api/exposure'
  : 'http://localhost:3001/api/exposure';

// ═══ Fetch ═══

export interface ExposureResult {
  events: ThreatEvent[];
  isLive: boolean;
  fetchedAt: string;
  error?: string;
}

/**
 * Récupère les événements d'exposition technique depuis /api/exposure.
 *
 * - En prod, les données viennent de l'Edge Function Vercel
 * - En dev, le plugin Vite interroge uniquement des sources live
 * - Toujours graceful : en cas d'erreur → tableau vide (jamais de crash)
 */
export async function fetchExposureEvents(forceFresh = false): Promise<ExposureResult> {
  const now = Date.now();

  if (!forceFresh && cache && (now - cache.fetchedAt) < CACHE_TTL) {
    return {
      events: cache.events,
      isLive: true,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
    };
  }

  try {
    const resp = await fetch(EXPOSURE_API_URL, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const events: ThreatEvent[] = await resp.json();
    const validEvents = Array.isArray(events) ? events : [];

    cache = { events: validEvents, fetchedAt: now };

    return {
      events: validEvents,
      isLive: true,
      fetchedAt: new Date(now).toISOString(),
    };
  } catch (err) {
    console.warn('[Exposure] Fetch failed (non-blocking):', err);
    return {
      events: cache?.events ?? [],
      isLive: false,
      fetchedAt: cache ? new Date(cache.fetchedAt).toISOString() : new Date(now).toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Invalide le cache exposure.
 */
export function invalidateExposureCache(): void {
  cache = null;
}
