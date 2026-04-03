/**
 * rte-iip.ts — Incidents HTB RTE via IIP (Inside Information Platform)
 *
 * Consomme les flux RSS publics de la plateforme IIP de RTE :
 *   - Indisponibilités de production   : /rss/production-unavailability
 *   - Indisponibilités du réseau (HTB) : /rss/transmission-unavailability
 *
 * Ces flux sont passés par le proxy RSS existant (/api/rss-proxy) pour
 * éviter les problèmes CORS et profiter du cache côté serveur.
 *
 * Temporalité : TEMPS RÉEL (publiés dès validation REMIT par RTE)
 * Fréquence de refresh recommandée : 10–15 min
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type IIPUnavailabilityType =
    | 'production'      // Indisponibilité centrale / groupe
    | 'transmission'    // Indisponibilité réseau HTB (transport)
    | 'other';          // Autres informations marché

export interface RTEIIPIncident {
    id: string;
    type: IIPUnavailabilityType;
    title: string;
    description: string;
    publishedAt: Date;
    updatedAt: Date | null;
    /** URL de la publication sur l'IIP */
    link: string;
    /** Capacité indisponible en MW (extraite du titre/description si présente) */
    capacityMW: number | null;
    /** Statut de l'incident (Active, Inactive, Withdrawn…) */
    status: 'active' | 'inactive' | 'withdrawn' | 'unknown';
    /** Unités/centrales affectées (noms extraits du titre) */
    assetNames: string[];
}

export interface RTEIIPState {
    incidents: RTEIIPIncident[];
    productionCount: number;
    transmissionCount: number;
    totalCapacityMW: number;   // Somme des MW indisponibles (production)
    fetchedAt: Date;
    /** true si au moins un flux a répondu */
    available: boolean;
    /** 'realtime' : données fraîches, 'stale' : cache expiré, 'unavailable' */
    freshness: 'realtime' | 'stale' | 'unavailable';
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Flux RSS IIP — publics sans authentification (REMIT obligatoire)
const IIP_FEEDS: Array<{ url: string; type: IIPUnavailabilityType }> = [
    {
        url: 'https://iip.cloud-rte-france.com/rss/production-unavailability',
        type: 'production',
    },
    {
        url: 'https://iip.cloud-rte-france.com/rss/transmission-unavailability',
        type: 'transmission',
    },
];

const CACHE_TTL_MS = 12 * 60_000;   // 12 min (flux mis à jour au fil des déclarations)
const FETCH_TIMEOUT_MS = 15_000;

// ── Module state ──────────────────────────────────────────────────────────────

let _cache: { state: RTEIIPState; fetchedAt: number } | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retourne l'état courant des incidents IIP RTE.
 * Utilise le proxy RSS existant (/api/rss-proxy ou plugin Vite en dev).
 */
export async function fetchRTEIIPIncidents(): Promise<RTEIIPState> {
    const now = Date.now();

    if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
        return _cache.state;
    }

    const results = await Promise.allSettled(
        IIP_FEEDS.map(feed => fetchFeed(feed.url, feed.type))
    );

    const incidents: RTEIIPIncident[] = [];
    let available = false;

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value.length > 0) {
            incidents.push(...result.value);
            available = true;
        } else if (result.status === 'fulfilled' && result.value.length === 0) {
            // Feed returned OK but empty — still counts as available
            available = true;
        }
    }

    const state = buildState(incidents, available);
    _cache = { state, fetchedAt: now };
    return state;
}

/**
 * Force le refresh du cache (bouton Actualiser dans l'UI).
 */
export function invalidateRTEIIPCache(): void {
    _cache = null;
}

// ── Feed fetcher ──────────────────────────────────────────────────────────────

async function fetchFeed(
    feedUrl: string,
    type: IIPUnavailabilityType
): Promise<RTEIIPIncident[]> {
    // Utilisation du proxy RSS JSON. En dev : plugin Vite rss-json-proxy.ts (/api/rss).
    // En prod : api/rss.js (Vercel). Retourne { items: [...] } JSON parsé depuis XML.
    // ⚠ Ne PAS utiliser /api/rss-proxy : il retourne du XML brut, pas du JSON.
    const proxyUrl = `/api/rss?url=${encodeURIComponent(feedUrl)}`;

    const resp = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
        throw new Error(`IIP RSS proxy returned HTTP ${resp.status} for ${feedUrl}`);
    }

    const json = await resp.json() as {
        items?: Array<{
            title?: string;
            description?: string;
            link?: string;
            pubDate?: string;
            isoDate?: string;
            guid?: string;
            id?: string;
        }>;
        error?: string;
    };

    if (json.error || !Array.isArray(json.items)) {
        console.warn(`[rte-iip] No items from ${feedUrl}:`, json.error ?? 'no items array');
        return [];
    }

    return json.items.map(item => parseItem(item, type));
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parseItem(
    item: Record<string, unknown>,
    type: IIPUnavailabilityType
): RTEIIPIncident {
    const raw = item as {
        title?: string;
        description?: string;
        link?: string;
        pubDate?: string;
        isoDate?: string;
        guid?: string;
        id?: string;
    };

    const title       = String(raw.title ?? '').trim();
    const description = stripHtml(String(raw.description ?? ''));
    const link        = String(raw.link ?? '');
    const pubDate     = parseDate(raw.isoDate ?? raw.pubDate);
    const id          = String(raw.guid ?? raw.id ?? link ?? `iip-${Date.now()}-${Math.random()}`);

    // ── Capacité MW ──
    // Patterns courants dans les titres IIP :
    //   "UNIT_NAME 1300 MW" / "910 MW unavailable" / "indisponibilité 450MW"
    const capacityMW = extractCapacityMW(title + ' ' + description);

    // ── Statut ──
    const status = extractStatus(title, description);

    // ── Assets (noms de centrales / ouvrages) ──
    const assetNames = extractAssetNames(title, type);

    return {
        id,
        type,
        title,
        description: description.slice(0, 500),   // Tronquer pour l'UI
        publishedAt: pubDate ?? new Date(),
        updatedAt: null,
        link,
        capacityMW,
        status,
        assetNames,
    };
}

// ── State builder ─────────────────────────────────────────────────────────────

function buildState(incidents: RTEIIPIncident[], available: boolean): RTEIIPState {
    const activeIncidents = incidents.filter(i => i.status !== 'withdrawn');
    const productionCount   = activeIncidents.filter(i => i.type === 'production').length;
    const transmissionCount = activeIncidents.filter(i => i.type === 'transmission').length;
    const totalCapacityMW   = activeIncidents
        .filter(i => i.type === 'production' && i.capacityMW != null)
        .reduce((sum, i) => sum + (i.capacityMW ?? 0), 0);

    return {
        incidents: activeIncidents.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
        productionCount,
        transmissionCount,
        totalCapacityMW: Math.round(totalCapacityMW),
        fetchedAt: new Date(),
        available,
        freshness: available ? 'realtime' : 'unavailable',
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(raw: string | undefined): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
}

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractCapacityMW(text: string): number | null {
    // Cas fréquents : "1300 MW", "1,300 MW", "450MW", "1.3 GW"
    const mw = text.match(/(\d[\d,.]*)[\s]*MW/i);
    if (mw) {
        const val = parseFloat(mw[1].replace(/,/g, ''));
        if (isFinite(val) && val > 0 && val < 50_000) return val;
    }
    const gw = text.match(/(\d[\d.]*)\s*GW/i);
    if (gw) {
        const val = parseFloat(gw[1]) * 1000;
        if (isFinite(val) && val > 0 && val < 50_000) return val;
    }
    return null;
}

function extractStatus(title: string, description: string): RTEIIPIncident['status'] {
    const combined = (title + ' ' + description).toLowerCase();
    if (combined.includes('withdrawn') || combined.includes('annulé') || combined.includes('retrait')) {
        return 'withdrawn';
    }
    if (combined.includes('inactive') || combined.includes('résolu') || combined.includes('terminé')) {
        return 'inactive';
    }
    if (combined.includes('active') || combined.includes('en cours') || combined.includes('ongoing')) {
        return 'active';
    }
    return 'unknown';
}

function extractAssetNames(title: string, type: IIPUnavailabilityType): string[] {
    if (type === 'transmission') {
        // Les lignes HTB sont souvent nommées "LIAGE XXX kV" ou similaire
        const kvMatch = title.match(/([A-Z][A-Za-zÀ-ÿ\s-]+\d{2,3}\s*kV)/);
        return kvMatch ? [kvMatch[1].trim()] : [];
    }
    // Production : souvent "Centrale de X" ou "Réacteur X"
    const nameMatch = title.match(/(?:réacteur|centrale|groupe|unit)\s+([A-Za-zÀ-ÿ\s\d-]+?)(?:\s+\d+\s*MW|\s*-|\s*:)/i);
    return nameMatch ? [nameMatch[1].trim()] : [];
}
