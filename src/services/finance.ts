import type { MarketData } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

Watchdog.register('finance', {
  label: 'Marchés Financiers',
  staleAfterMs: 15 * 60_000,
  detail: 'Marketstack — CAC 40, indices, valeurs défense / énergie',
  freshness: 'TEMPS_REEL',
});

// Hardcode mapping of symbols to human names
const SYMBOL_NAMES: Record<string, string> = {
    'CAC.INDX': 'CAC 40',
    'DAX.INDX': 'DAX 40',
    'STOXX50.INDX': 'Euro Stoxx 50',
    'SPX.INDX': 'S&P 500',
    'TTE.PA': 'TotalEnergies',
    'AIR.PA': 'Airbus',
    'HO.PA': 'Thales',
    'SAF.PA': 'Safran',
    'DG.PA': 'Vinci',        // Infrastructures / Autoroutes
    'SAN.PA': 'Sanofi',      // Santé / Épidémies
    'ORA.PA': 'Orange',      // Télécoms / Cyber
    'GLE.PA': 'Soc. Générale', // Banques / Stabilité financière
    'EURUSD=X': 'EUR / USD',
    'EURGBP=X': 'EUR / GBP',
    'EURCHF=X': 'EUR / CHF',
    'EURJPY=X': 'EUR / JPY'
};

// Fonction utilitaire pour générer une fausse courbe (random walk) qui se termine par `currentPrice` et a varié de `changePercent`
const SYMBOL_CATEGORIES: Record<string, 'indices' | 'defense' | 'services' | 'devises'> = {
    'CAC.INDX': 'indices',
    'DAX.INDX': 'indices',
    'STOXX50.INDX': 'indices',
    'SPX.INDX': 'indices',
    'TTE.PA': 'defense',
    'AIR.PA': 'defense',
    'HO.PA': 'defense',
    'SAF.PA': 'defense',
    'DG.PA': 'services',
    'SAN.PA': 'services',
    'ORA.PA': 'services',
    'GLE.PA': 'services',
    'EURUSD=X': 'devises',
    'EURGBP=X': 'devises',
    'EURCHF=X': 'devises',
    'EURJPY=X': 'devises'
};

function createSeededRandom(seedText: string): () => number {
    let seed = 2166136261;
    for (let i = 0; i < seedText.length; i += 1) {
        seed ^= seedText.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }

    return () => {
        seed += 0x6D2B79F5;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildSyntheticHistory(
    symbol: string,
    currentPrice: number,
    referencePrice: number,
    trend: MarketData['trend'],
): number[] {
    if (!(currentPrice > 0) || !(referencePrice > 0)) {
        return [];
    }

    const points = 36;
    const start = referencePrice;
    const end = currentPrice;
    const delta = end - start;
    const rand = createSeededRandom(`${symbol}:${start.toFixed(4)}:${end.toFixed(4)}:${trend}`);
    const volatility = Math.max(Math.abs(delta) * 0.9, currentPrice * (trend === 'flat' ? 0.0025 : 0.0065));

    const series: number[] = [start];
    let runningNoise = 0;

    for (let index = 1; index < points - 1; index += 1) {
        const progress = index / (points - 1);
        const baseline = start + delta * progress;

        // Brownian bridge style: bruit irrégulier au milieu, ancré aux extrémités.
        const taper = Math.sin(progress * Math.PI);
        const driftBias =
            trend === 'up' ? 0.18 :
            trend === 'down' ? -0.18 :
            0;
        const shock = ((rand() - 0.5) * 2 + driftBias * (1 - progress)) * volatility * 0.22;
        runningNoise = (runningNoise * 0.55) + shock;

        const microJitter = ((rand() - 0.5) * 2) * volatility * 0.04;
        const value = baseline + (runningNoise * taper) + microJitter;
        series.push(Math.max(0, value));
    }

    series.push(end);
    return series;
}

/**
 * Fetch market data from proxy (or vercel edge fn).
 * Returns array of parsed MarketData.
 */
export async function fetchMarketData(): Promise<MarketData[]> {
    Watchdog.report('finance', { type: 'loading' });
    const _t0 = Date.now();
    try {
        const resp = await fetch('/api/finance/market');
        if (!resp.ok) {
            const reason = resp.status === 429 ? 'quota Marketstack dépassé' : `HTTP ${resp.status}`;
            console.warn('[Finance] API returned', resp.status);
            Watchdog.report('finance', { type: 'failure', error: reason });
            return [];
        }

        const data = await resp.json();
        if (!data || !data.data || !Array.isArray(data.data)) {
            console.warn('[Finance] Invalid data structure or missing keys');
            Watchdog.report('finance', { type: 'failure', error: 'structure API inattendue' });
            return [];
        }

        const results: MarketData[] = [];

        // L'API intraday/latest de Marketstack peut ramener plusieurs records par symbole pour la journée
        // On va garder qu'un seul par symbol (le premier, qui est le latest)
        // et on utilise (last - open) pour un proxy de la pct_change (Marketstack intraday n'inclut pas pct change par defaut sur le plan gratuit)
        const seen = new Set<string>();

        for (const item of data.data) {
            const sym = item.symbol;
            if (!SYMBOL_CATEGORIES[sym]) continue;
            if (seen.has(sym)) continue;
            seen.add(sym);

            const last = item.last || item.close || 0;
            const open = item.open || last; // fallback to last if open missing

            // Avoid division by zero
            let pctChange = 0;
            if (open > 0) {
                pctChange = ((last - open) / open) * 100;
            }

            let trend: 'up' | 'down' | 'flat' = 'flat';
            if (pctChange > 0.1) trend = 'up';
            else if (pctChange < -0.1) trend = 'down';

            results.push({
                symbol: sym,
                name: SYMBOL_NAMES[sym] || sym,
                price: last,
                changePercent: pctChange,
                trend,
                lastUpdated: new Date(item.date || Date.now()),
                history: buildSyntheticHistory(sym, last, open, trend),
                category: SYMBOL_CATEGORIES[sym] || 'indices'
            });
        }

        Watchdog.report('finance', {
            type: 'success',
            responseTimeMs: Date.now() - _t0,
            detail: `${results.length} symboles`,
        });
        return results;

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Finance] Fetch failed', err);
        Watchdog.report('finance', { type: 'failure', error: msg });
        return [];
    }
}
