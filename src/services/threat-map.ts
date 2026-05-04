/**
 * threat-map.ts — Service Cartographie des Menaces Cyber
 *
 * Agrège plusieurs sources pour produire des ThreatEvent géolocalisés
 * destinés à la couche Deck.gl :
 *   - /api/threats   : incidents français agrégés côté serveur
 *   - RansomwareLive : victimes françaises ransomwares
 *   - CERT-FR RSS    : alertes techniques ANSSI
 *
 * Architecture calquée sur cyber.ts (circuit breaker, cache TTL, sources status).
 *
 * Éthique & Sécurité :
 *   - Pas d'IPs exposées ni données personnelles
 *   - Données agrégées uniquement, niveau organisation
 *   - Sources publiques légales uniquement
 *   - Niveau de confiance explicite par événement
 */

import type { ThreatEvent } from '../types/index.ts';
import { CITIES } from '../config/geo.ts';
import { fetchExposureEvents } from './exposure.ts';

// ═══ Cache ═══

interface ThreatMapCache {
  events: ThreatEvent[];
  fetchedAt: number;
  sources: ThreatSourceStatus[];
}

export interface ThreatSourceStatus {
  name: string;
  isUp: boolean;
  lastSync: string;
  count: number;
  error?: string;
}

export type ThreatSeverityFilter = 'all' | ThreatEvent['severity'];
export type ThreatTypeFilter = 'all' | ThreatEvent['type'];
export type ThreatTimeFilter = '7d' | '30d' | '90d' | '1y' | '2y' | 'all';

export interface ThreatEventFilters {
  severity: ThreatSeverityFilter;
  type: ThreatTypeFilter;
  time: ThreatTimeFilter;
  query: string;
}

export const DEFAULT_THREAT_EVENT_FILTERS: ThreatEventFilters = {
  severity: 'all',
  type: 'all',
  time: 'all',
  query: '',
};

let cache: ThreatMapCache | null = null;
const CACHE_TTL = 10 * 60_000; // 10 minutes

// ═══ API URLs ═══

const JSON_PROXY_URL = import.meta.env.PROD
  ? '/api/json-proxy'
  : 'http://localhost:3001/api/json-proxy';

const RSS_PROXY_URL = import.meta.env.PROD
  ? '/api/rss'
  : 'http://localhost:3001/api/rss';

// Endpoint dédié threats (Phase 3 — Vercel serverless)
const THREATS_API_URL = import.meta.env.PROD
  ? '/api/threats'
  : 'http://localhost:3001/api/threats';

// ═══ Geolocation helpers ═══

/** Secteurs → coordonnées approximatives FR (géocentroïdes économiques) */
const SECTOR_FALLBACK_COORDS: Record<string, [number, number]> = {
  'Santé': [2.3522, 48.8566],        // Paris — ministère santé
  'Commerce': [2.3522, 48.8566],
  'Finance': [2.3522, 48.8566],
  'Collectivités': [2.3522, 46.2276],// France centre
  'Industrie': [2.2137, 46.2276],
  'Transport': [2.3522, 48.8566],
  'Éducation': [2.3522, 48.8566],
  'Télécoms': [2.3522, 48.8566],
  'Défense': [2.3522, 48.8566],
  'Energie': [2.3522, 46.2276],
};

/** Résolution géo minimale : ville/région → coordonnées */
function resolveCoordinates(
  city: string | undefined,
  _region: string | undefined,
  sector: string | undefined,
): { coordinates: [number, number]; label: string; precision: ThreatEvent['location']['precision'] } {
  if (city) {
    const cityLower = city.toLowerCase().split(/[\s,]+/)[0];
    // Match against CITIES config (e.g. 'paris', 'lyon', 'marseille'...)
    if (CITIES[cityLower]) {
      return {
        coordinates: CITIES[cityLower],
        label: city,
        precision: 'city',
      };
    }
  }

  // Fallback secteur
  if (sector && SECTOR_FALLBACK_COORDS[sector]) {
    return {
      coordinates: SECTOR_FALLBACK_COORDS[sector],
      label: sector,
      precision: 'region',
    };
  }

  // Fallback France (centroïde)
  return {
    coordinates: [2.2137, 46.2276],
    label: 'France',
    precision: 'country',
  };
}

function buildRansomwareSummary(
  victim: RansomwareRawVictim,
): string {
  if (isInformativeRansomwareDescription(victim.description)) {
    return victim.description!.slice(0, 260);
  }

  return 'La source publique ne fournit pas de détail technique confirmé sur le vecteur, le chiffrement, le volume de données ou l’impact opérationnel.';
}

function isInformativeRansomwareDescription(value: string | undefined): boolean {
  const text = (value || '').trim();
  return Boolean(text && !/^\[?ai generated\]?\s*n\/?a$/i.test(text) && !/^n\/?a$/i.test(text));
}

// ═══ RansomwareLive normalization ═══

interface RansomwareRawVictim {
  post_title: string;
  country: string;
  activity?: string;
  discovered: string;
  group_name: string;
  post_url?: string;
  website?: string;
  city?: string;
  region?: string;
  country_code?: string;
  published?: string;
  description?: string;
}

function normalizeRansomwareVictim(v: RansomwareRawVictim, index: number): ThreatEvent {
  const geo = resolveCoordinates(v.city, v.region, v.activity);

  // Extraire le domain depuis le website ou post_title
  let domain: string | undefined;
  if (v.website) {
    try {
      domain = new URL(v.website.startsWith('http') ? v.website : `https://${v.website}`).hostname;
    } catch { /* ignore */ }
  }

  return {
    id: `ransomware-live-${index}-${Date.now()}`,
    type: 'ransomware',
    organizationName: v.post_title || 'Organisation inconnue',
    domain,
    countryCode: 'FR',
    countryName: 'France',
    flagEmoji: '🇫🇷',
    ransomwareGroup: v.group_name,
    sourceLabel: 'RansomwareLive',
    location: {
      label: v.city || v.region || 'France',
      coordinates: geo.coordinates,
      precision: geo.precision,
    },
    severity: 'high', // Ransomwares = toujours high minimum
    confidence: 'high',
    sector: v.activity || 'Inconnu',
    date: v.discovered,
    summary: buildRansomwareSummary(v),
    metrics: {
      sources: 1,
    },
    sources: [
      {
        name: 'RansomwareLive',
        url: v.post_url || 'https://ransomware.live',
        observedAt: new Date().toISOString(),
      },
    ],
  };
}

async function fetchRansomwareThreatEvents(): Promise<{ events: ThreatEvent[]; status: ThreatSourceStatus }> {
  const now = new Date().toISOString();
  const url = `${JSON_PROXY_URL}?url=${encodeURIComponent('https://data.ransomware.live/posts.json')}`;

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const raw: RansomwareRawVictim[] = await resp.json();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const frenchVictims = (Array.isArray(raw) ? raw : []).filter((v) => {
      const country = (v.country || '').toLowerCase();
      const isFrench = country === 'france' || country === 'fr';
      const isRecent = !isNaN(new Date(v.discovered).getTime()) &&
        new Date(v.discovered).getTime() > thirtyDaysAgo;
      return isFrench && isRecent;
    });

    const events = frenchVictims.slice(0, 50).map((v, i) => normalizeRansomwareVictim(v, i));

    return {
      events,
      status: { name: 'RansomwareLive', isUp: true, lastSync: now, count: events.length },
    };
  } catch (err) {
    console.error('[ThreatMap/Ransomware] Fetch failed:', err);
    return {
      events: [],
      status: { name: 'RansomwareLive', isUp: false, lastSync: now, count: 0, error: String(err) },
    };
  }
}

// ═══ CERT-FR ANSSI (alertes techniques → events vulnerability) ═══

interface CertFrItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
}

function parseCertFrSeverity(title: string): ThreatEvent['severity'] {
  const lower = title.toLowerCase();
  if (lower.includes('critique') || lower.includes('critical') || lower.includes('0-day')) return 'critical';
  if (lower.includes('-ale') || lower.includes('importante') || lower.includes('élevé')) return 'high';
  if (lower.includes('moyenne') || lower.includes('medium')) return 'medium';
  return 'low';
}

function normalizeCertFrItem(item: CertFrItem, index: number): ThreatEvent {
  return {
    id: `cert-fr-${index}-${new Date(item.pubDate).getTime()}`,
    type: 'vulnerability',
    organizationName: 'CERT-FR / ANSSI',
    domain: 'cert.ssi.gouv.fr',
    countryCode: 'FR',
    countryName: 'France',
    flagEmoji: '🇫🇷',
    sourceLabel: 'CERT-FR',
    location: {
      label: 'France',
      coordinates: [2.3522, 48.8566], // Paris, siège ANSSI
      precision: 'hq',
    },
    severity: parseCertFrSeverity(item.title),
    confidence: 'high',
    sector: 'Gouvernement',
    date: item.pubDate,
    summary: item.title,
    sources: [
      {
        name: 'CERT-FR',
        url: item.link,
        observedAt: new Date().toISOString(),
      },
    ],
  };
}

async function fetchCertFrThreatEvents(): Promise<{ events: ThreatEvent[]; status: ThreatSourceStatus }> {
  const now = new Date().toISOString();
  const certUrl = 'https://www.cert.ssi.gouv.fr/feed/';
  const proxyUrl = `${RSS_PROXY_URL}?url=${encodeURIComponent(certUrl)}`;

  try {
    const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const items: CertFrItem[] = data.items || [];
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const recentItems = items
      .filter(item => new Date(item.pubDate).getTime() > thirtyDaysAgo)
      .slice(0, 15);

    const events = recentItems.map((item, i) => normalizeCertFrItem(item, i));

    return {
      events,
      status: { name: 'CERT-FR', isUp: true, lastSync: now, count: events.length },
    };
  } catch (err) {
    console.error('[ThreatMap/CERT-FR] Fetch failed:', err);
    return {
      events: [],
      status: { name: 'CERT-FR', isUp: false, lastSync: now, count: 0, error: String(err) },
    };
  }
}

// ═══ Dedicated Threats API (Phase 3 — production endpoint) ═══

async function fetchFromThreatsApi(): Promise<{ events: ThreatEvent[]; status: ThreatSourceStatus }> {
  const now = new Date().toISOString();
  try {
    const resp = await fetch(THREATS_API_URL, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data: ThreatEvent[] = await resp.json();
    return {
      events: Array.isArray(data) ? data : [],
      status: { name: 'FranceMonitor Threats API', isUp: true, lastSync: now, count: data.length },
    };
  } catch {
    // Silently fail — will fall back to individual sources
    return {
      events: [],
      status: { name: 'FranceMonitor Threats API', isUp: false, lastSync: now, count: 0 },
    };
  }
}

// ═══ Deduplication ═══

/** Déduplique par (organizationName + type) dans une fenêtre de 30j */
function deduplicateEvents(events: ThreatEvent[]): ThreatEvent[] {
  const seen = new Set<string>();
  return events.filter(e => {
    const key = `${e.organizationName.toLowerCase()}-${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFranceThreat(event: ThreatEvent): boolean {
  if (event.sourceLabel === 'FrenchBreaches Map') return true;

  const countryCode = (event.countryCode || '').toUpperCase();
  const countryName = (event.countryName || '').toLowerCase();
  const domain = (event.domain || '').toLowerCase();
  const locationLabel = (event.location?.label || '').toLowerCase();

  return countryCode === 'FR' ||
    countryName === 'france' ||
    domain.endsWith('.fr') ||
    locationLabel.includes('france') ||
    locationLabel.includes('paris');
}

function getTimeCutoff(filter: ThreatTimeFilter): number {
  const daysByFilter: Record<Exclude<ThreatTimeFilter, 'all'>, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '1y': 365,
    '2y': 730,
  };
  if (filter === 'all') return Number.NEGATIVE_INFINITY;
  return Date.now() - daysByFilter[filter] * 24 * 60 * 60 * 1000;
}

export function filterThreatEvents(events: ThreatEvent[], filters: ThreatEventFilters): ThreatEvent[] {
  const cutoff = getTimeCutoff(filters.time);
  const query = filters.query.trim().toLowerCase();

  return events.filter((event) => {
    const eventTime = new Date(event.date).getTime();
    if (!Number.isFinite(eventTime) || eventTime < cutoff) return false;
    if (filters.severity !== 'all' && event.severity !== filters.severity) return false;
    if (filters.type !== 'all' && event.type !== filters.type) return false;
    if (!query) return true;

    return event.organizationName.toLowerCase().includes(query) ||
      (event.domain || '').toLowerCase().includes(query) ||
      (event.sector || '').toLowerCase().includes(query) ||
      (event.location?.label || '').toLowerCase().includes(query) ||
      (event.ransomwareGroup || '').toLowerCase().includes(query) ||
      (event.sourceLabel || '').toLowerCase().includes(query);
  });
}

// ═══ Main export ═══

export interface ThreatMapState {
  events: ThreatEvent[];
  sources: ThreatSourceStatus[];
  fetchedAt: string;
  isMockData: boolean;
}

/**
 * Récupère les menaces cyber géolocalisées pour la couche carte.
 *
 * Agrège uniquement des sources live : RansomwareLive + CERT-FR + API dédiée
 * + exposition passive si les sources répondent.
 *
 * @param forceFresh - Ignorer le cache (utile au refresh manuel)
 */
export async function fetchThreatMapEvents(forceFresh = false): Promise<ThreatMapState> {
  const now = Date.now();

  // Retourner le cache si encore frais
  if (!forceFresh && cache && (now - cache.fetchedAt) < CACHE_TTL) {
    return {
      events: cache.events,
      sources: cache.sources,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      isMockData: false,
    };
  }

  console.log('[ThreatMap] Fetching threat events from all sources...');

  // Tenter d'abord l'API dédiée (prod)
  const [apiResult, ransomwareResult, certFrResult, exposureResult] = await Promise.allSettled([
    fetchFromThreatsApi(),
    fetchRansomwareThreatEvents(),
    fetchCertFrThreatEvents(),
    // Phase 4 : Exposition passive (Shodan InternetDB, agrégée)
    fetchExposureEvents().then(r => ({ events: r.events, status: { name: 'Shodan/Exposure', isUp: r.isLive, lastSync: r.fetchedAt, count: r.events.length } })),
  ]);

  const apiData = apiResult.status === 'fulfilled' ? apiResult.value : { events: [], status: { name: 'Threats API', isUp: false, lastSync: new Date().toISOString(), count: 0 } };
  const ransomwareData = ransomwareResult.status === 'fulfilled' ? ransomwareResult.value : { events: [], status: { name: 'RansomwareLive', isUp: false, lastSync: new Date().toISOString(), count: 0 } };
  const certFrData = certFrResult.status === 'fulfilled' ? certFrResult.value : { events: [], status: { name: 'CERT-FR', isUp: false, lastSync: new Date().toISOString(), count: 0 } };
  const exposureData = exposureResult.status === 'fulfilled' ? exposureResult.value : { events: [], status: { name: 'Shodan/Exposure', isUp: false, lastSync: new Date().toISOString(), count: 0 } };

  // Fusionner : API dédiée en priorité, puis sources individuelles.
  // Garde stricte : la carte cyber ne doit afficher que des événements France.
  const allEvents = [
    ...apiData.events,
    ...ransomwareData.events,
    ...certFrData.events,
    ...exposureData.events,
  ].filter(isFranceThreat);

  const uniqueEvents = deduplicateEvents(allEvents);
  const sources = [apiData.status, ransomwareData.status, certFrData.status, exposureData.status];

  if (uniqueEvents.length === 0) {
    console.warn('[ThreatMap] No events from any source — APIs may be unreachable');
  } else {
    console.log(`[ThreatMap] ${uniqueEvents.length} France events loaded`);
  }

  cache = {
    events: uniqueEvents,
    fetchedAt: now,
    sources,
  };

  return {
    events: uniqueEvents,
    sources,
    fetchedAt: new Date(now).toISOString(),
    isMockData: false,
  };
}

/**
 * Invalider le cache manuellement (ex: après toggle de couche)
 */
export function invalidateThreatMapCache(): void {
  cache = null;
}

/**
 * Retourne l'état de cache courant sans refetch.
 * Utile pour afficher le statut dans StatusPanel.
 */
export function getThreatMapCacheStatus(): { events: number; age: number } | null {
  if (!cache) return null;
  return {
    events: cache.events.length,
    age: Math.floor((Date.now() - cache.fetchedAt) / 1000),
  };
}
