/**
 * space-weather.ts — Météo spatiale NOAA SWPC
 *
 * Sources :
 *  - NOAA SWPC Kp index (1 min) : https://services.swpc.noaa.gov
 *
 * Exports :
 *  - fetchSpaceWeather()        → Kp courant + niveau d'alerte ; null si jamais lu (V1 : une panne n'est jamais un « Calme »)
 */


// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpaceWeatherData {
    kpIndex:    number;
    level:      'quiet' | 'unsettled' | 'active' | 'storm-g1' | 'storm-g2' | 'storm-g3' | 'extreme';
    levelLabel: string;
    riskFrance: string;
    color:      string;
    fetchedAt:  Date;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60_000; // 15 min (données Kp : update toutes les 3 min)
let _cache: { data: SpaceWeatherData; ts: number } | null = null;

// ── Classification Kp ─────────────────────────────────────────────────────────

function classifyKp(kp: number): Omit<SpaceWeatherData, 'kpIndex' | 'fetchedAt'> {
    if (kp >= 8) return {
        level: 'extreme',   levelLabel: 'Extrême G4-G5',
        color: '#7C3AED',
        riskFrance: 'Coupures HTA possibles en France, dommages transformateurs',
    };
    if (kp >= 7) return {
        level: 'storm-g3',  levelLabel: 'Tempête G3',
        color: '#DC2626',
        riskFrance: 'Perturbations réseau haute tension, GPS et HF dégradés',
    };
    if (kp >= 6) return {
        level: 'storm-g2',  levelLabel: 'Tempête G2',
        color: '#EA580C',
        riskFrance: 'Corrections orbitales satellites, radio HF perturbée',
    };
    if (kp >= 5) return {
        level: 'storm-g1',  levelLabel: 'Tempête G1',
        color: '#D97706',
        riskFrance: 'Faibles fluctuations réseau électrique haute tension',
    };
    if (kp >= 4) return {
        level: 'active',    levelLabel: 'Active',
        color: '#CA8A04',
        riskFrance: 'Activité géomagnétique modérée : surveillance recommandée',
    };
    if (kp >= 2) return {
        level: 'unsettled', levelLabel: 'Agitée',
        color: '#16A34A',
        riskFrance: 'Aucun risque infrastructure',
    };
    return {
        level: 'quiet',     levelLabel: 'Calme',
        color: '#15803D',
        riskFrance: 'Aucun risque infrastructure',
    };
}

// ── Fetch NOAA SWPC ───────────────────────────────────────────────────────────

/**
 * Kp courant. En panne (réseau, HTTP, réponse vide ou sans Kp lisible) : la dernière lecture réussie, datée par son `fetchedAt`, sinon
 * null ; jamais un Kp 0 « Calme » inventé (revue finale I5 : le panneau Énergie et le baromètre disent alors « n.d. », sans couleur).
 */
export async function fetchSpaceWeather(): Promise<SpaceWeatherData | null> {
    if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;

    try {
        const res = await fetch(
            'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
            { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json: unknown = await res.json();
        const last: unknown = Array.isArray(json) ? json[json.length - 1] : undefined;
        const raw = last && typeof last === 'object' ? (last as { kp_index?: unknown }).kp_index : undefined;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error('Kp non publié');
        const kp = Math.round(raw);

        const data: SpaceWeatherData = { kpIndex: kp, ...classifyKp(kp), fetchedAt: new Date() };
        _cache = { data, ts: Date.now() };
        return data;

    } catch {
        return _cache?.data ?? null;
    }
}
