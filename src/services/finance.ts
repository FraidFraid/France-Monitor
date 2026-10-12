import type { MarketData } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

Watchdog.register('finance', {
  label: 'Marchés Financiers',
  staleAfterMs: 15 * 60_000,
  detail: 'TradingView : indices et valeurs suivies (score et poste)',
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
            const reason = resp.status === 429 ? 'limite TradingView atteinte' : `HTTP ${resp.status}`;
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
                history: [], // aucune courbe inventée (spec 2026-10-12) : TradingView ne fournit que le dernier cours
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
