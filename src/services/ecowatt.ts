/**
 * ecowatt.ts — Écowatt (signal national RTE) + éco2mix (mix électrique par région, informatif).
 *
 * Écowatt est un signal NATIONAL publié par RTE : il n'existe pas de déclinaison régionale. Il
 * est récupéré via /api/energy/ecowatt-signal (API RTE v5, jour J à J+3 ; repli open data ODRÉ
 * « nouveau_signal_ecowatt », jours passés seulement — jamais présenté comme le signal du jour,
 * cf. ecowatt-official.ts).
 *
 * Le mix éco2mix par région (production / consommation, ODRÉ eco2mix-regional-tr) est récupéré
 * séparément via /api/energy/ecowatt : c'est une donnée de CONTEXTE, PAS une vigilance — une
 * région structurellement importatrice (Île-de-France, Pays de la Loire, Bourgogne-Franche-Comté,
 * Bretagne, PACA…) ne signale aucune tension en soi.
 *
 * Les deux sources sont récupérées en parallèle (Promise.allSettled) et sont indépendantes :
 * l'échec du signal officiel ne fait pas échouer le mix éco2mix, et réciproquement.
 */

import type { EcowattOfficial, EcowattResponse, EnergyMix, InterconnectionFlow } from '../types/index.ts';
import { isEcowattOfficial } from './ecowatt-official.ts';
import { Watchdog } from './watchdog.ts';
import { dedupe } from '../utils/inflight.ts';
import { readPersisted, writePersisted } from '../utils/persistentCache.ts';

const BASE_DETAIL = 'RTE Écowatt v5 (national) + ODRÉ éco2mix (mix régional, informatif) · ~15 min';

// ── Watchdog registration ──
Watchdog.register('ecowatt', {
    label: 'Écowatt RTE + éco2mix',
    staleAfterMs: 15 * 60_000,
    detail: BASE_DETAIL,
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

interface EcowattMix {
    mixes: Record<string, EnergyMix>;
    national: EnergyMix;
    interconnections: InterconnectionFlow[];
}

/** Cache simple en mémoire */
let cache: { data: EcowattResponse; fetchedAt: number } | null = null;
const CACHE_TTL = 15 * 60_000; // 15 min (aligné sur la granularité des données)

/** Cache localStorage : peint le dernier signal connu au rechargement si < 10 min. */
const PERSIST_TTL_MS = 10 * 60_000;
const PERSIST_KEY = 'ecowatt-v2';

function isEcowattResponse(value: unknown): value is EcowattResponse {
    return !!value && typeof value === 'object' && 'official' in value && 'mixes' in value;
}

const MIX_API_URL = '/api/energy/ecowatt';
const SIGNAL_API_URL = '/api/energy/ecowatt-signal';

/** JSON.parse ne revit pas les `Date` : les timestamps stockés en localStorage
 * reviennent en chaînes ISO — on les reconvertit pour respecter le contrat
 * de type `EnergyMix.timestamp: Date` consommé ailleurs dans le code. */
function reviveEcowattDates(data: EcowattResponse): EcowattResponse {
    return {
        ...data,
        national: { ...data.national, timestamp: new Date(data.national.timestamp) },
        mixes: Object.fromEntries(
            Object.entries(data.mixes).map(([code, mix]) => [code, { ...mix, timestamp: new Date(mix.timestamp) }]),
        ),
    };
}

/** Fetch le mix éco2mix par région + national + échanges frontaliers (ODRÉ, inchangé). */
async function fetchMix(): Promise<EcowattMix> {
    // Single-flight : le widget baromètre réseau (warm-up) et le
    // chargement des couches critiques appellent tous les deux
    // fetchEcowatt() quasi simultanément au démarrage. On déduplique
    // fetch ET parsing JSON ensemble : un corps de réponse ne se lit
    // qu'une fois, impossible de partager juste la Response.
    const json = await dedupe(MIX_API_URL, async () => {
        const resp = await fetch(MIX_API_URL, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return (await resp.json()) as { regional: Eco2mixResponse, national: Eco2mixNatResponse };
    });
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

    const mixes: Record<string, EnergyMix> = {};
    let natNuclear = 0, natWind = 0, natSolar = 0, natHydro = 0, natGas = 0, natOther = 0, natTotal = 0;
    let latestDate = new Date(0);

    for (const [code, rec] of latestByRegion) {
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

    return { mixes, national, interconnections };
}

/**
 * Fetch le signal Écowatt officiel. Ne lève jamais : un échec réseau, une réponse HTTP non-OK ou
 * une forme invalide rendent `null` plutôt que de faire échouer tout `fetchEcowatt()` (le mix
 * éco2mix reste utilisable même quand le signal officiel est indisponible).
 */
async function fetchSignal(): Promise<EcowattOfficial | null> {
    try {
        const json = await dedupe(SIGNAL_API_URL, async () => {
            const resp = await fetch(SIGNAL_API_URL, { signal: AbortSignal.timeout(10_000) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return (await resp.json()) as { official?: unknown };
        });
        return isEcowattOfficial(json.official) ? json.official : null;
    } catch (err) {
        console.warn('[Écowatt] Signal officiel indisponible:', err);
        return null;
    }
}

/** Détail Watchdog reflétant la provenance du signal officiel courant. */
function watchdogDetail(official: EcowattOfficial | null): string {
    if (!official) return 'signal officiel indisponible';
    if (official.source === 'odre') return 'dernier signal publié (open data, J-1)';
    return BASE_DETAIL;
}

/**
 * Fetch le signal Écowatt officiel (national, RTE) et le mix éco2mix (régional + national +
 * échanges frontaliers). Retourne EcowattResponse.
 */
export async function fetchEcowatt(): Promise<EcowattResponse> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data;

    const fallback: EcowattResponse = {
        official: null,
        mixes: {},
        national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
        interconnections: [],
    };

    // Rechargement de page : peindre le dernier signal connu (< 10 min) avant réseau.
    const persisted = readPersisted<EcowattResponse>(PERSIST_KEY, PERSIST_TTL_MS, isEcowattResponse);
    if (persisted) {
        const revived = reviveEcowattDates(persisted);
        cache = { data: revived, fetchedAt: Date.now() };
        return revived;
    }

    Watchdog.report('ecowatt', { type: 'loading' });
    const t0 = Date.now();

    const [mixSettled, signalSettled] = await Promise.allSettled([fetchMix(), fetchSignal()]);

    if (mixSettled.status === 'rejected') {
        const err = mixSettled.reason;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Éco2mix] Fetch failed, using cache or defaults:', err);
        Watchdog.report('ecowatt', { type: 'failure', error: msg, isFallback: !!cache });
        return cache?.data ?? fallback;
    }

    const { mixes, national, interconnections } = mixSettled.value;
    const official = signalSettled.status === 'fulfilled' ? signalSettled.value : null;

    const result: EcowattResponse = { official, mixes, national, interconnections };

    cache = { data: result, fetchedAt: Date.now() };
    writePersisted(PERSIST_KEY, result);
    Watchdog.report('ecowatt', {
        type: 'success',
        responseTimeMs: Date.now() - t0,
        detail: watchdogDetail(official),
    });

    const nRegions = Object.keys(mixes).length;
    console.log(`[Écowatt] ${nRegions} régions éco2mix · signal officiel : ${official ? official.source : 'indisponible'}`);

    return result;
}
