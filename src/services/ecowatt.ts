/**
 * ecowatt.ts — Signal énergétique par région via eco2mix temps réel (ODRE).
 *
 * Source : https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-regional-tr/records
 * Aucune authentification requise. Données mises à jour toutes les 15 min (avec ~1h de lag).
 *
 * Le signal est calculé depuis le ratio consommation / production locale :
 *   - ratio < 1.10 → vert   (production locale couvre la consommation)
 *   - ratio 1.10–1.25 → orange (dépendance modérée aux imports)
 *   - ratio > 1.25  → rouge  (forte dépendance aux imports)
 */

import type { EcowattSignal, EcowattResponse, EnergyMix, InterconnectionFlow } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

// ── Watchdog registration ──
Watchdog.register('ecowatt', {
    label: 'Écowatt RTE',
    staleAfterMs: 15 * 60_000,
    detail: 'ODRE éco2mix-regional-tr · mise à jour ~15 min',
});

interface Eco2mixRecord {
    code_insee_region: string;
    libelle_region: string;
    date_heure: string;
    consommation: number | null;
    nucleaire: number | null;
    eolien: number | null;
    solaire: number | null;
    hydraulique: number | null;
    thermique: number | null;
    bioenergies: number | null;
    ech_physiques: number | null;
}

interface Eco2mixResponse {
    total_count: number;
    results: Eco2mixRecord[];
}

/** Cache simple en mémoire */
let cache: { data: EcowattResponse; fetchedAt: number } | null = null;
const CACHE_TTL = 15 * 60_000; // 15 min (aligné sur la granularité des données)

const API_URL = import.meta.env.PROD
    ? '/api/energy/ecowatt'
    : 'http://localhost:3001/api/energy/ecowatt';

interface Eco2mixNatRecord {
    ech_comm_angleterre: number | null;
    ech_comm_espagne: number | null;
    ech_comm_italie: number | null;
    ech_comm_suisse: number | null;
    ech_comm_allemagne_belgique: number | null;
}

interface Eco2mixNatResponse {
    results: Eco2mixNatRecord[];
}

/**
 * Calcule un signal Écowatt-like à partir du ratio consommation / production locale.
 * Les régions importatrices nettes sont en tension (orange/rouge).
 */
function computeSignal(rec: Eco2mixRecord): EcowattSignal {
    const conso = rec.consommation ?? 0;
    if (conso === 0) return 'green';

    // Somme de toutes les filières locales (MW)
    const production =
        (rec.nucleaire ?? 0) +
        (rec.eolien ?? 0) +
        (rec.solaire ?? 0) +
        (rec.hydraulique ?? 0) +
        (rec.thermique ?? 0) +
        (rec.bioenergies ?? 0);

    if (production === 0) {
        // Pas de donnée de production — fallback sur échanges physiques
        const ech = rec.ech_physiques ?? 0;
        if (ech < -3000) return 'red';
        if (ech < -1000) return 'orange';
        return 'green';
    }

    const ratio = conso / production;

    if (ratio > 1.25) return 'red';    // Dépendance forte aux imports
    if (ratio > 1.10) return 'orange'; // Dépendance modérée
    return 'green';                    // Autonome ou exportatrice
}

/**
 * Fetch les signaux énergétiques par région (eco2mix temps réel).
 * Retourne EcowattResponse (signaux et mix par région, et mix national).
 */
export async function fetchEcowatt(): Promise<EcowattResponse> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data;

    const fallback: EcowattResponse = { signals: {}, mixes: {}, national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 }, interconnections: [] };

    Watchdog.report('ecowatt', { type: 'loading' });
    const t0 = Date.now();

    try {
        const resp = await fetch(API_URL, { signal: AbortSignal.timeout(10_000) });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const json = await resp.json() as { regional: Eco2mixResponse, national: Eco2mixNatResponse };
        const jsonReg = json.regional;
        const jsonNat = json.national;

        if (!jsonReg.results || jsonReg.results.length === 0) {
            throw new Error('No records returned');
        }

        // On garde seulement le record le plus récent par région
        const latestByRegion = new Map<string, Eco2mixRecord>();
        for (const rec of jsonReg.results) {
            const code = rec.code_insee_region;
            if (!code) continue;
            const existing = latestByRegion.get(code);
            if (!existing || rec.date_heure > existing.date_heure) {
                latestByRegion.set(code, rec);
            }
        }

        const signals: Record<string, EcowattSignal> = {};
        const mixes: Record<string, EnergyMix> = {};
        let natNuclear = 0, natWind = 0, natSolar = 0, natHydro = 0, natGas = 0, natOther = 0, natTotal = 0;
        let latestDate = new Date(0);

        for (const [code, rec] of latestByRegion) {
            signals[code] = computeSignal(rec);

            const recTimestamp = new Date(rec.date_heure);
            if (recTimestamp > latestDate) latestDate = recTimestamp;

            const nuc = rec.nucleaire ?? 0;
            const win = rec.eolien ?? 0;
            const sol = rec.solaire ?? 0;
            const hyd = rec.hydraulique ?? 0;
            const gas = rec.thermique ?? 0;
            const oth = rec.bioenergies ?? 0;
            const tot = nuc + win + sol + hyd + gas + oth; // production locale totale

            mixes[code] = {
                timestamp: recTimestamp,
                nuclear: nuc,
                wind: win,
                solar: sol,
                hydro: hyd,
                gas: gas,
                other: oth,
                total: tot
            };

            natNuclear += nuc;
            natWind += win;
            natSolar += sol;
            natHydro += hyd;
            natGas += gas;
            natOther += oth;
            natTotal += tot;
        }

        const national: EnergyMix = {
            timestamp: latestDate,
            nuclear: natNuclear,
            wind: natWind,
            solar: natSolar,
            hydro: natHydro,
            gas: natGas,
            other: natOther,
            total: natTotal
        };

        const interconnections: InterconnectionFlow[] = [];
        if (jsonNat.results && jsonNat.results.length > 0) {
            const natRec = jsonNat.results[0];
            if (natRec.ech_comm_angleterre != null) {
                interconnections.push({ country: 'Royaume-Uni', flowMW: natRec.ech_comm_angleterre, coordinates: [1.3, 51.1] });
            }
            if (natRec.ech_comm_espagne != null) {
                interconnections.push({ country: 'Espagne', flowMW: natRec.ech_comm_espagne, coordinates: [-0.1, 42.7] });
            }
            if (natRec.ech_comm_italie != null) {
                interconnections.push({ country: 'Italie', flowMW: natRec.ech_comm_italie, coordinates: [7.3, 45.1] });
            }
            if (natRec.ech_comm_suisse != null) {
                interconnections.push({ country: 'Suisse', flowMW: natRec.ech_comm_suisse, coordinates: [6.1, 46.2] });
            }
            if (natRec.ech_comm_allemagne_belgique != null) {
                interconnections.push({ country: 'All./Bel.', flowMW: natRec.ech_comm_allemagne_belgique, coordinates: [7.0, 49.3] });
            }
        }

        const result: EcowattResponse = { signals, mixes, national, interconnections };

        cache = { data: result, fetchedAt: Date.now() };
        Watchdog.report('ecowatt', { type: 'success', responseTimeMs: Date.now() - t0 });

        const nRegions = Object.keys(signals).length;
        const nOrange = Object.values(signals).filter(s => s === 'orange').length;
        const nRed = Object.values(signals).filter(s => s === 'red').length;
        console.log(`[Éco2mix] ${nRegions} régions — 🟢 ${nRegions - nOrange - nRed} / 🟡 ${nOrange} / 🔴 ${nRed}`);

        return result;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Éco2mix] Fetch failed, using cache or defaults:', err);
        Watchdog.report('ecowatt', { type: 'failure', error: msg, isFallback: !!cache });
        return cache?.data ?? fallback;
    }
}
